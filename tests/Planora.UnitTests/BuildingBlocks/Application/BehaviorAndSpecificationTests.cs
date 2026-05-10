using System.Security.Claims;
using FluentValidation;
using FluentValidation.Results;
using Planora.BuildingBlocks.Application.Behaviors;
using Planora.BuildingBlocks.Domain.Exceptions;
using Planora.BuildingBlocks.Domain.Specifications;
using MediatR;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;
using AppValidationException = Planora.BuildingBlocks.Application.Validation.ValidationException;

namespace Planora.UnitTests.BuildingBlocks.Application;

public class BehaviorAndSpecificationTests
{
    [Fact]
    [Trait("TestType", "Module")]
    [Trait("TestType", "Regression")]
    public async Task LoggingBehavior_ShouldAttachOperationLogContextAndReturnResponse()
    {
        var logger = new CapturingLogger<LoggingBehavior<SampleCommand, SampleResponse>>();
        var httpContext = new DefaultHttpContext
        {
            TraceIdentifier = "trace-123"
        };
        httpContext.User = new ClaimsPrincipal(new ClaimsIdentity(new[]
        {
            new Claim("sub", "user-123")
        }, "test"));
        var accessor = new HttpContextAccessor { HttpContext = httpContext };
        var behavior = new LoggingBehavior<SampleCommand, SampleResponse>(logger, accessor);

        var response = await behavior.Handle(
            new SampleCommand("secret-password", "api-token"),
            () => Task.FromResult(new SampleResponse("ok-token")),
            CancellationToken.None);

        Assert.Equal("ok-token", response.Token);
        Assert.Equal(nameof(SampleCommand), httpContext.Items["Operation"]);
        Assert.Contains(logger.Entries, entry => entry.Level == LogLevel.Information && entry.Message.Contains("Command Started"));
        Assert.Contains(logger.Entries, entry => entry.Level == LogLevel.Information && entry.Message.Contains("Command Completed"));
        Assert.DoesNotContain(logger.Entries, entry => entry.Message.Contains("secret-password", StringComparison.Ordinal));
    }

    [Fact]
    [Trait("TestType", "Module")]
    public async Task LoggingBehavior_ShouldLogAndRethrowHandlerExceptions()
    {
        var logger = new CapturingLogger<LoggingBehavior<SampleQuery, string>>();
        var behavior = new LoggingBehavior<SampleQuery, string>(logger);

        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            behavior.Handle(
                new SampleQuery("boom"),
                () => Task.FromException<string>(new InvalidOperationException("handler failed")),
                CancellationToken.None));

        Assert.Contains(logger.Entries, entry =>
            entry.Level == LogLevel.Error &&
            entry.Exception is InvalidOperationException &&
            entry.Message.Contains("Query Failed"));
    }

    [Fact]
    [Trait("TestType", "Module")]
    [Trait("TestType", "Regression")]
    public async Task LoggingBehavior_ShouldHandleRequestFallbackNullResponseAndArrayRedaction()
    {
        var requestLogger = new CapturingLogger<LoggingBehavior<PlainRequest, string?>>();
        var requestBehavior = new LoggingBehavior<PlainRequest, string?>(requestLogger);
        var fallbackLogger = new CapturingLogger<LoggingBehavior<SelfReferencingRequest, string>>();
        var fallbackBehavior = new LoggingBehavior<SelfReferencingRequest, string>(fallbackLogger);
        var arrayLogger = new CapturingLogger<LoggingBehavior<SampleQuery, ResponseWithArray>>();
        var arrayBehavior = new LoggingBehavior<SampleQuery, ResponseWithArray>(arrayLogger);

        var nullResponse = await requestBehavior.Handle(
            new PlainRequest("plain"),
            () => Task.FromResult<string?>(null),
            CancellationToken.None);
        var fallbackResponse = await fallbackBehavior.Handle(
            new SelfReferencingRequest(),
            () => Task.FromResult("fallback-ok"),
            CancellationToken.None);
        var arrayResponse = await arrayBehavior.Handle(
            new SampleQuery("array"),
            () => Task.FromResult(new ResponseWithArray(new[] { new SensitiveItem("token-one") })),
            CancellationToken.None);

        Assert.Null(nullResponse);
        Assert.Equal("fallback-ok", fallbackResponse);
        Assert.Equal("token-one", Assert.Single(arrayResponse.Items).Token);
        Assert.Contains(requestLogger.Entries, entry => entry.Message.Contains("Request Started"));
        Assert.Contains(requestLogger.Entries, entry => entry.Message.Contains("Response: null"));
        Assert.Contains(fallbackLogger.Entries, entry => entry.Message.Contains(nameof(SelfReferencingRequest)));
        Assert.DoesNotContain(arrayLogger.Entries, entry => entry.Message.Contains("token-one", StringComparison.Ordinal));
    }

    [Fact]
    [Trait("TestType", "Module")]
    [Trait("TestType", "Regression")]
    public async Task LoggingBehavior_ShouldLogSlaWarningForVerySlowRequests()
    {
        var logger = new CapturingLogger<LoggingBehavior<SlowQuery, string>>();
        var behavior = new LoggingBehavior<SlowQuery, string>(logger);

        var response = await behavior.Handle(
            new SlowQuery("slow"),
            async () =>
            {
                await Task.Delay(5100);
                return "slow-ok";
            },
            CancellationToken.None);

        Assert.Equal("slow-ok", response);
        Assert.Contains(logger.Entries, entry =>
            entry.Level == LogLevel.Warning &&
            entry.Message.Contains("PERFORMANCE SLA BREACH"));
    }

    [Fact]
    [Trait("TestType", "Module")]
    [Trait("TestType", "Regression")]
    public async Task UnhandledExceptionBehavior_ShouldReturnResponseOrLogAndRethrowUnhandledExceptions()
    {
        var logger = new CapturingLogger<UnhandledExceptionBehavior<SampleQuery, string>>();
        var behavior = new UnhandledExceptionBehavior<SampleQuery, string>(logger);

        var success = await behavior.Handle(
            new SampleQuery("ok"),
            () => Task.FromResult("ok"),
            CancellationToken.None);

        var exception = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            behavior.Handle(
                new SampleQuery("boom"),
                () => Task.FromException<string>(new InvalidOperationException("handler exploded")),
                CancellationToken.None));

        Assert.Equal("ok", success);
        Assert.Equal("handler exploded", exception.Message);
        Assert.Contains(logger.Entries, entry =>
            entry.Level == LogLevel.Error &&
            entry.Exception is InvalidOperationException &&
            entry.Message.Contains("Unhandled Exception") &&
            entry.Message.Contains(nameof(SampleQuery)));
    }

    [Fact]
    [Trait("TestType", "Module")]
    [Trait("TestType", "Regression")]
    public async Task ValidationBehavior_ShouldBypassValidators_WhenNoneRegistered()
    {
        var logger = new CapturingLogger<ValidationBehavior<SampleCommand, SampleResponse>>();
        var behavior = new ValidationBehavior<SampleCommand, SampleResponse>(
            Array.Empty<IValidator<SampleCommand>>(),
            logger);
        var nextCalled = false;

        var response = await behavior.Handle(
            new SampleCommand("", ""),
            () =>
            {
                nextCalled = true;
                return Task.FromResult(new SampleResponse("ok"));
            },
            CancellationToken.None);

        Assert.True(nextCalled);
        Assert.Equal("ok", response.Token);
        Assert.Empty(logger.Entries);
    }

    [Fact]
    [Trait("TestType", "Module")]
    [Trait("TestType", "Regression")]
    public async Task ValidationBehavior_ShouldRunAllValidatorsAndContinue_WhenValid()
    {
        var validatorOne = new InlineValidator<SampleCommand>();
        validatorOne.RuleFor(command => command.Password).NotEmpty();
        var validatorTwo = new InlineValidator<SampleCommand>();
        validatorTwo.RuleFor(command => command.Token).NotEmpty();
        var behavior = new ValidationBehavior<SampleCommand, SampleResponse>(
            new IValidator<SampleCommand>[] { validatorOne, validatorTwo },
            new CapturingLogger<ValidationBehavior<SampleCommand, SampleResponse>>());

        var response = await behavior.Handle(
            new SampleCommand("password", "token"),
            () => Task.FromResult(new SampleResponse("accepted")),
            CancellationToken.None);

        Assert.Equal("accepted", response.Token);
    }

    [Fact]
    [Trait("TestType", "Module")]
    [Trait("TestType", "Regression")]
    public async Task ValidationBehavior_ShouldThrowApplicationValidationExceptionAndSkipHandler_WhenInvalid()
    {
        var logger = new CapturingLogger<ValidationBehavior<SampleCommand, SampleResponse>>();
        var validator = new InlineValidator<SampleCommand>();
        validator.RuleFor(command => command.Password).NotEmpty().WithMessage("Password is required");
        validator.RuleFor(command => command.Token).Custom((_, context) =>
            context.AddFailure(new ValidationFailure("Token", "Token is invalid")));
        var behavior = new ValidationBehavior<SampleCommand, SampleResponse>(
            new[] { validator },
            logger);
        var nextCalled = false;

        var exception = await Assert.ThrowsAsync<AppValidationException>(() =>
            behavior.Handle(
                new SampleCommand("", "bad"),
                () =>
                {
                    nextCalled = true;
                    return Task.FromResult(new SampleResponse("should-not-run"));
                },
                CancellationToken.None));

        Assert.False(nextCalled);
        Assert.Equal("VALIDATION.INVALID_INPUT", exception.ErrorCode);
        Assert.Equal(new[] { "Password is required" }, exception.Errors["Password"]);
        Assert.Equal(new[] { "Token is invalid" }, exception.Errors["Token"]);
        Assert.Contains(logger.Entries, entry =>
            entry.Level == LogLevel.Warning &&
            entry.Message.Contains(nameof(SampleCommand)) &&
            entry.Message.Contains("Password is required"));
    }

    [Fact]
    [Trait("TestType", "Module")]
    [Trait("TestType", "Regression")]
    public async Task PerformanceBehavior_ShouldReturnResponseAndOnlyWarnForSlowRequests()
    {
        var logger = new CapturingLogger<PerformanceBehavior<SampleQuery, string>>();
        var behavior = new PerformanceBehavior<SampleQuery, string>(logger);

        var fastResponse = await behavior.Handle(
            new SampleQuery("fast"),
            () => Task.FromResult("fast-ok"),
            CancellationToken.None);

        var slowResponse = await behavior.Handle(
            new SampleQuery("slow"),
            async () =>
            {
                await Task.Delay(520);
                return "slow-ok";
            },
            CancellationToken.None);

        Assert.Equal("fast-ok", fastResponse);
        Assert.Equal("slow-ok", slowResponse);
        Assert.Single(logger.Entries);
        Assert.Contains(logger.Entries, entry =>
            entry.Level == LogLevel.Warning &&
            entry.Message.Contains("Long Running Request") &&
            entry.Message.Contains(nameof(SampleQuery)));
    }

    [Fact]
    [Trait("TestType", "Module")]
    public void BaseSpecification_ShouldExposeCriteriaIncludesOrderingPagingAndQueryFlags()
    {
        var specification = new ActiveUserSpecification();

        Assert.NotNull(specification.Criteria);
        Assert.True(specification.Criteria!.Compile()(new SpecificationUser("active", true)));
        Assert.False(specification.Criteria.Compile()(new SpecificationUser("inactive", false)));
        Assert.Single(specification.Includes);
        Assert.Single(specification.IncludeStrings);
        Assert.NotNull(specification.OrderBy);
        Assert.NotNull(specification.OrderByDescending);
        Assert.Equal(20, specification.Skip);
        Assert.Equal(10, specification.Take);
        Assert.True(specification.AsTracking);
        Assert.True(specification.AsSplitQuery);
    }

    [Fact]
    [Trait("TestType", "Module")]
    [Trait("TestType", "Regression")]
    public void BaseSpecification_DefaultConstructor_ShouldAllowCriteriaToBeAddedLater()
    {
        var specification = new CriteriaOnlySpecification();

        Assert.NotNull(specification.Criteria);
        Assert.True(specification.Criteria!.Compile()(new SpecificationUser("ada", true)));
        Assert.False(specification.Criteria.Compile()(new SpecificationUser("grace", false)));
        Assert.Empty(specification.Includes);
        Assert.Empty(specification.IncludeStrings);
    }

    [Fact]
    [Trait("TestType", "Regression")]
    public void ValidationException_StringConstructor_ShouldPreserveCustomMessageAndErrors()
    {
        var errors = new Dictionary<string, string[]>
        {
            ["Email"] = new[] { "Email is invalid" }
        };

        var exception = new AppValidationException("Custom validation message", errors);

        Assert.Equal("Custom validation message", exception.Message);
        Assert.Same(errors, exception.Errors);
        Assert.Equal("VALIDATION.INVALID_INPUT", exception.ErrorCode);
    }

    [Fact]
    [Trait("TestType", "Regression")]
    public void ProblemDetailsContextAndErrorCategoryExtensions_ShouldMapAllPublicErrorContracts()
    {
        var context = new Planora.BuildingBlocks.Domain.Exceptions.ProblemDetailsContext
        {
            ErrorCode = "VALIDATION",
            Title = "Validation Error",
            Detail = "Bad input",
            StatusCode = 400,
            Instance = "/todos",
            TraceId = "trace-id",
            UserId = "user-id",
            ServiceName = "TodoApi",
            OperationName = "CreateTodo",
            ElapsedMilliseconds = 12
        };

        context.AddExtension("correlationId", "corr-1");
        context.AddValidationError("Title", "Title is required", "Title is too long");

        Assert.Equal("corr-1", context.Extensions!["correlationId"]);
        Assert.Equal(new[] { "Title is required", "Title is too long" }, context.ValidationErrors!["Title"]);

        Assert.Equal(400, ErrorCategory.Validation.GetStatusCode());
        Assert.Equal(401, ErrorCategory.Unauthorized.GetStatusCode());
        Assert.Equal(403, ErrorCategory.Forbidden.GetStatusCode());
        Assert.Equal(404, ErrorCategory.NotFound.GetStatusCode());
        Assert.Equal(409, ErrorCategory.Conflict.GetStatusCode());
        Assert.Equal(503, ErrorCategory.ServiceUnavailable.GetStatusCode());
        Assert.Equal(500, ErrorCategory.InternalServer.GetStatusCode());
        Assert.Equal(500, ErrorCategory.Unexpected.GetStatusCode());

        Assert.Equal("Validation Error", ErrorCategory.Validation.GetTitle());
        Assert.Equal("Unauthorized", ErrorCategory.Unauthorized.GetTitle());
        Assert.Equal("Forbidden", ErrorCategory.Forbidden.GetTitle());
        Assert.Equal("Not Found", ErrorCategory.NotFound.GetTitle());
        Assert.Equal("Conflict", ErrorCategory.Conflict.GetTitle());
        Assert.Equal("Service Unavailable", ErrorCategory.ServiceUnavailable.GetTitle());
        Assert.Equal("Internal Server Error", ErrorCategory.InternalServer.GetTitle());
        Assert.Equal("Unexpected Error", ErrorCategory.Unexpected.GetTitle());
        Assert.Equal(500, ((ErrorCategory)999).GetStatusCode());
        Assert.Equal("Error", ((ErrorCategory)999).GetTitle());
    }

    private sealed record SampleCommand(string Password, string Token);
    private sealed record SampleQuery(string Name);
    private sealed record SampleResponse(string Token);
    private sealed record PlainRequest(string Name);
    private sealed record SlowQuery(string Name);
    private sealed record ResponseWithArray(SensitiveItem[] Items);
    private sealed record SensitiveItem(string Token);

    private sealed class SelfReferencingRequest
    {
        public SelfReferencingRequest Self => this;
    }

    private sealed record SpecificationUser(string Name, bool IsActive)
    {
        public string Profile { get; init; } = "profile";
    }

    private sealed class ActiveUserSpecification : BaseSpecification<SpecificationUser>
    {
        public ActiveUserSpecification() : base(user => user.IsActive)
        {
            AddInclude(user => user.Profile);
            AddInclude("Settings");
            ApplyOrderBy(user => user.Name);
            ApplyOrderByDescending(user => user.Profile);
            ApplyPaging(20, 10);
            ApplyTracking();
            ApplySplitQuery();
        }
    }

    private sealed class CriteriaOnlySpecification : BaseSpecification<SpecificationUser>
    {
        public CriteriaOnlySpecification()
        {
            AddCriteria(user => user.IsActive);
        }
    }

    private sealed class CapturingLogger<T> : ILogger<T>
    {
        public List<LogEntry> Entries { get; } = new();

        public IDisposable BeginScope<TState>(TState state) where TState : notnull => NullScope.Instance;
        public bool IsEnabled(LogLevel logLevel) => true;

        public void Log<TState>(
            LogLevel logLevel,
            EventId eventId,
            TState state,
            Exception? exception,
            Func<TState, Exception?, string> formatter)
        {
            Entries.Add(new LogEntry(logLevel, formatter(state, exception), exception));
        }
    }

    private sealed record LogEntry(LogLevel Level, string Message, Exception? Exception);

    private sealed class NullScope : IDisposable
    {
        public static readonly NullScope Instance = new();
        public void Dispose()
        {
        }
    }
}
