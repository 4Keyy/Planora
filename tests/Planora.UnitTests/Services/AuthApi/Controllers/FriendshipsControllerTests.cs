using Planora.Auth.Api.Controllers;
using Planora.Auth.Application.Features.Friendships.Commands.AcceptFriendRequest;
using Planora.Auth.Application.Features.Friendships.Commands.RejectFriendRequest;
using Planora.Auth.Application.Features.Friendships.Commands.RemoveFriend;
using Planora.Auth.Application.Features.Friendships.Commands.SendFriendRequest;
using Planora.Auth.Application.Features.Friendships.Commands.SendFriendRequestByEmail;
using Planora.Auth.Application.Features.Friendships.Queries.GetFriendIds;
using Planora.Auth.Application.Features.Friendships.Queries.GetFriendRequests;
using Planora.Auth.Application.Features.Friendships.Queries.GetFriends;
using Planora.BuildingBlocks.Application.Models;
using Planora.BuildingBlocks.Application.Pagination;
using MediatR;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;
using Moq;
using System.Text.Json;

namespace Planora.UnitTests.Services.AuthApi.Controllers;

public class FriendshipsControllerTests
{
    [Fact]
    [Trait("TestType", "Functional")]
    [Trait("TestType", "Regression")]
    public async Task FriendshipCommands_MapSuccessAndFailureResponses()
    {
        var friendshipId = Guid.NewGuid();
        var friendId = Guid.NewGuid();

        var created = await SendRequestWith(Result.Success());
        Assert.Equal(nameof(FriendshipsController.GetFriendRequests), Assert.IsType<CreatedAtActionResult>(created).ActionName);
        Assert.IsType<OkObjectResult>(await SendRequestByEmailWith(Result.Success()));
        Assert.IsType<BadRequestObjectResult>(await SendRequestByEmailWith(Result.Failure("BAD", "bad")));

        Assert.IsType<BadRequestObjectResult>(await SendRequestWith(Result.Failure("BAD", "bad")));
        Assert.IsType<OkObjectResult>(await AcceptWith(friendshipId, Result.Success()));
        Assert.IsType<BadRequestObjectResult>(await AcceptWith(friendshipId, Result.Failure("BAD", "bad")));
        Assert.IsType<OkObjectResult>(await RejectWith(friendshipId, Result.Success()));
        Assert.IsType<BadRequestObjectResult>(await RejectWith(friendshipId, Result.Failure("BAD", "bad")));
        Assert.IsType<NoContentResult>(await RemoveWith(friendId, Result.Success()));
        Assert.IsType<BadRequestObjectResult>(await RemoveWith(friendId, Result.Failure("BAD", "bad")));
    }

    [Fact]
    [Trait("TestType", "Functional")]
    [Trait("TestType", "Regression")]
    public async Task FriendshipQueries_MapMediatorResults()
    {
        var mediator = new Mock<IMediator>();
        GetFriendsQuery? sentFriendsQuery = null;
        GetFriendRequestsQuery? sentRequestsQuery = null;
        var friends = new PagedResult<FriendDto>(new[] { new FriendDto { Id = Guid.NewGuid(), Email = "friend@example.com" } }, 2, 25, 1);
        var requests = new List<FriendRequestDto> { new() { FriendshipId = Guid.NewGuid(), Email = "incoming@example.com" } };

        mediator.Setup(x => x.Send(It.IsAny<GetFriendsQuery>(), It.IsAny<CancellationToken>()))
            .Callback<IRequest<Result<PagedResult<FriendDto>>>, CancellationToken>((query, _) => sentFriendsQuery = (GetFriendsQuery)query)
            .ReturnsAsync(Result.Success(friends));
        mediator.Setup(x => x.Send(It.IsAny<GetFriendRequestsQuery>(), It.IsAny<CancellationToken>()))
            .Callback<IRequest<Result<IReadOnlyList<FriendRequestDto>>>, CancellationToken>((query, _) => sentRequestsQuery = (GetFriendRequestsQuery)query)
            .ReturnsAsync(Result.Success<IReadOnlyList<FriendRequestDto>>(requests));
        var controller = CreateController(mediator);

        var friendsResponse = await controller.GetFriends(2, 25, CancellationToken.None);
        var requestsResponse = await controller.GetFriendRequests(incoming: false, CancellationToken.None);

        Assert.Same(friends, Assert.IsType<OkObjectResult>(friendsResponse.Result).Value);
        Assert.Equal(2, sentFriendsQuery!.PageNumber);
        Assert.Equal(25, sentFriendsQuery.PageSize);
        Assert.Same(requests, Assert.IsType<OkObjectResult>(requestsResponse.Result).Value);
        Assert.False(sentRequestsQuery!.Incoming);
    }

    [Fact]
    [Trait("TestType", "Functional")]
    [Trait("TestType", "Regression")]
    public async Task FriendshipQueries_MapFailuresToBadRequest()
    {
        var mediator = new Mock<IMediator>();
        mediator.Setup(x => x.Send(It.IsAny<GetFriendsQuery>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Failure<PagedResult<FriendDto>>("BAD", "bad"));
        mediator.Setup(x => x.Send(It.IsAny<GetFriendRequestsQuery>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Failure<IReadOnlyList<FriendRequestDto>>("BAD", "bad"));
        var controller = CreateController(mediator);

        Assert.IsType<BadRequestObjectResult>((await controller.GetFriends(cancellationToken: CancellationToken.None)).Result);
        Assert.IsType<BadRequestObjectResult>((await controller.GetFriendRequests(cancellationToken: CancellationToken.None)).Result);
    }

    [Fact]
    [Trait("TestType", "Security")]
    [Trait("TestType", "Regression")]
    public async Task InternalFriendshipEndpoints_FailClosedOnFailureOrExceptions()
    {
        var userId = Guid.NewGuid();
        var friendId = Guid.NewGuid();

        var success = await GetFriendIdsWith(Result.Success(new List<Guid> { friendId }), userId);
        Assert.Contains(friendId.ToString(), JsonSerializer.Serialize(Assert.IsType<OkObjectResult>(success.Result).Value), StringComparison.OrdinalIgnoreCase);

        var failure = await GetFriendIdsWith(Result.Failure<List<Guid>>("BAD", "bad"), userId);
        Assert.IsType<BadRequestResult>(failure.Result);

        var exception = await GetFriendIdsThrowing(userId);
        Assert.Contains("value", Assert.IsType<OkObjectResult>(exception.Result).Value!.ToString(), StringComparison.Ordinal);

        var areFriends = await AreFriendsWith(Result.Success(new List<Guid> { friendId }), userId, friendId);
        Assert.Contains("True", Assert.IsType<OkObjectResult>(areFriends.Result).Value!.ToString(), StringComparison.OrdinalIgnoreCase);

        var notFriends = await AreFriendsWith(Result.Success(new List<Guid>()), userId, friendId);
        Assert.Contains("False", Assert.IsType<OkObjectResult>(notFriends.Result).Value!.ToString(), StringComparison.OrdinalIgnoreCase);

        var failedCheck = await AreFriendsWith(Result.Failure<List<Guid>>("BAD", "bad"), userId, friendId);
        Assert.Contains("False", Assert.IsType<OkObjectResult>(failedCheck.Result).Value!.ToString(), StringComparison.OrdinalIgnoreCase);

        var exceptionCheck = await AreFriendsThrowing(userId, friendId);
        Assert.Contains("False", Assert.IsType<OkObjectResult>(exceptionCheck.Result).Value!.ToString(), StringComparison.OrdinalIgnoreCase);
    }

    private static async Task<IActionResult> SendRequestWith(Result result)
    {
        var mediator = new Mock<IMediator>();
        SendFriendRequestCommand? sentCommand = null;
        mediator.Setup(x => x.Send(It.IsAny<SendFriendRequestCommand>(), It.IsAny<CancellationToken>()))
            .Callback<IRequest<Result>, CancellationToken>((command, _) => sentCommand = (SendFriendRequestCommand)command)
            .ReturnsAsync(result);
        var friendId = Guid.NewGuid();

        var response = await CreateController(mediator).SendFriendRequest(new SendFriendRequestCommand(friendId), CancellationToken.None);

        Assert.Equal(friendId, sentCommand!.FriendId);
        return response;
    }

    private static async Task<IActionResult> SendRequestByEmailWith(Result result)
    {
        var mediator = new Mock<IMediator>();
        SendFriendRequestByEmailCommand? sentCommand = null;
        mediator.Setup(x => x.Send(It.IsAny<SendFriendRequestByEmailCommand>(), It.IsAny<CancellationToken>()))
            .Callback<IRequest<Result>, CancellationToken>((command, _) => sentCommand = (SendFriendRequestByEmailCommand)command)
            .ReturnsAsync(result);

        var response = await CreateController(mediator).SendFriendRequestByEmail(
            new SendFriendRequestByEmailCommand("friend@example.com"),
            CancellationToken.None);

        Assert.Equal("friend@example.com", sentCommand!.Email);
        return response;
    }

    private static async Task<IActionResult> AcceptWith(Guid friendshipId, Result result)
    {
        var mediator = new Mock<IMediator>();
        AcceptFriendRequestCommand? sentCommand = null;
        mediator.Setup(x => x.Send(It.IsAny<AcceptFriendRequestCommand>(), It.IsAny<CancellationToken>()))
            .Callback<IRequest<Result>, CancellationToken>((command, _) => sentCommand = (AcceptFriendRequestCommand)command)
            .ReturnsAsync(result);

        var response = await CreateController(mediator).AcceptFriendRequest(friendshipId, CancellationToken.None);

        Assert.Equal(friendshipId, sentCommand!.FriendshipId);
        return response;
    }

    private static async Task<IActionResult> RejectWith(Guid friendshipId, Result result)
    {
        var mediator = new Mock<IMediator>();
        RejectFriendRequestCommand? sentCommand = null;
        mediator.Setup(x => x.Send(It.IsAny<RejectFriendRequestCommand>(), It.IsAny<CancellationToken>()))
            .Callback<IRequest<Result>, CancellationToken>((command, _) => sentCommand = (RejectFriendRequestCommand)command)
            .ReturnsAsync(result);

        var response = await CreateController(mediator).RejectFriendRequest(friendshipId, CancellationToken.None);

        Assert.Equal(friendshipId, sentCommand!.FriendshipId);
        return response;
    }

    private static async Task<IActionResult> RemoveWith(Guid friendId, Result result)
    {
        var mediator = new Mock<IMediator>();
        RemoveFriendCommand? sentCommand = null;
        mediator.Setup(x => x.Send(It.IsAny<RemoveFriendCommand>(), It.IsAny<CancellationToken>()))
            .Callback<IRequest<Result>, CancellationToken>((command, _) => sentCommand = (RemoveFriendCommand)command)
            .ReturnsAsync(result);

        var response = await CreateController(mediator).RemoveFriend(friendId, CancellationToken.None);

        Assert.Equal(friendId, sentCommand!.FriendId);
        return response;
    }

    private static Task<ActionResult<List<Guid>>> GetFriendIdsWith(Result<List<Guid>> result, Guid userId)
    {
        var mediator = new Mock<IMediator>();
        mediator.Setup(x => x.Send(It.IsAny<GetFriendIdsQuery>(), It.IsAny<CancellationToken>())).ReturnsAsync(result);
        return CreateController(mediator).GetFriendIds(userId, CancellationToken.None);
    }

    private static Task<ActionResult<List<Guid>>> GetFriendIdsThrowing(Guid userId)
    {
        var mediator = new Mock<IMediator>();
        mediator.Setup(x => x.Send(It.IsAny<GetFriendIdsQuery>(), It.IsAny<CancellationToken>())).ThrowsAsync(new InvalidOperationException("down"));
        return CreateController(mediator).GetFriendIds(userId, CancellationToken.None);
    }

    private static Task<ActionResult<bool>> AreFriendsWith(Result<List<Guid>> result, Guid userId, Guid friendId)
    {
        var mediator = new Mock<IMediator>();
        mediator.Setup(x => x.Send(It.IsAny<GetFriendIdsQuery>(), It.IsAny<CancellationToken>())).ReturnsAsync(result);
        return CreateController(mediator).AreFriends(userId, friendId, CancellationToken.None);
    }

    private static Task<ActionResult<bool>> AreFriendsThrowing(Guid userId, Guid friendId)
    {
        var mediator = new Mock<IMediator>();
        mediator.Setup(x => x.Send(It.IsAny<GetFriendIdsQuery>(), It.IsAny<CancellationToken>())).ThrowsAsync(new InvalidOperationException("down"));
        return CreateController(mediator).AreFriends(userId, friendId, CancellationToken.None);
    }

    private static FriendshipsController CreateController(Mock<IMediator> mediator)
        => new(
            mediator.Object,
            Mock.Of<ILogger<FriendshipsController>>());
}
