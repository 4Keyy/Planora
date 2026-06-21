using Planora.Auth.Application.Features.Users.Queries.GetUsers;
using Planora.Auth.Domain.Enums;
using Planora.BuildingBlocks.Application.Pagination;

namespace Planora.Auth.Application.Features.Users.Handlers.GetUsers
{
    public sealed class GetUsersQueryHandler : IRequestHandler<GetUsersQuery, Result<PagedResult<UserListDto>>>
    {
        private readonly IUserRepository _userRepository;
        private readonly IMapper _mapper;
        private readonly ILogger<GetUsersQueryHandler> _logger;

        public GetUsersQueryHandler(
            IUserRepository userRepository,
            IMapper mapper,
            ILogger<GetUsersQueryHandler> logger)
        {
            _userRepository = userRepository;
            _mapper = mapper;
            _logger = logger;
        }

        public async Task<Result<PagedResult<UserListDto>>> Handle(
            GetUsersQuery query,
            CancellationToken cancellationToken)
        {
            try
            {
                UserStatus? statusFilter = null;
                if (!string.IsNullOrEmpty(query.Status) &&
                    Enum.TryParse<UserStatus>(query.Status, out var parsedStatus))
                {
                    statusFilter = parsedStatus;
                }

                var filter = new UserListFilter
                {
                    Status = statusFilter,
                    SearchTerm = query.SearchTerm,
                    CreatedFrom = query.CreatedFrom,
                    CreatedTo = query.CreatedTo,
                    OrderBy = query.OrderBy,
                    Ascending = query.Ascending,
                    PageNumber = query.PageNumber,
                    PageSize = query.PageSize
                };

                var (users, totalCount) = await _userRepository.GetPagedAsync(filter, cancellationToken);

                var userDtos = _mapper.Map<List<UserListDto>>(users.ToList());

                var result = new PagedResult<UserListDto>(
                    userDtos,
                    query.PageNumber,
                    query.PageSize,
                    totalCount);

                return Result.Success(result);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error retrieving users list");
                return Result.Failure<PagedResult<UserListDto>>(
                    Error.InternalServer("GET_USERS_ERROR", "An error occurred while retrieving users"));
            }
        }
    }
}
