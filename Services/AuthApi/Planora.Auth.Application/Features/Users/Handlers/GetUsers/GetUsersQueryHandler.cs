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
                var users = await _userRepository.GetAllAsync(cancellationToken);

                var filteredUsers = users.AsQueryable();

                if (!string.IsNullOrEmpty(query.Status) &&
                    Enum.TryParse<UserStatus>(query.Status, out var status))
                {
                    filteredUsers = filteredUsers.Where(u => u.Status == status);
                }

                if (!string.IsNullOrEmpty(query.SearchTerm))
                {
                    var searchLower = query.SearchTerm.ToLower();
                    filteredUsers = filteredUsers.Where(u =>
                        u.Email.Value.Contains(searchLower) ||
                        u.FirstName.ToLower().Contains(searchLower) ||
                        u.LastName.ToLower().Contains(searchLower));
                }

                if (query.CreatedFrom.HasValue)
                {
                    filteredUsers = filteredUsers.Where(u => u.CreatedAt >= query.CreatedFrom.Value);
                }

                if (query.CreatedTo.HasValue)
                {
                    filteredUsers = filteredUsers.Where(u => u.CreatedAt <= query.CreatedTo.Value);
                }

                filteredUsers = query.OrderBy?.ToLower() switch
                {
                    "email" => query.Ascending
                        ? filteredUsers.OrderBy(u => u.Email.Value)
                        : filteredUsers.OrderByDescending(u => u.Email.Value),
                    "firstname" => query.Ascending
                        ? filteredUsers.OrderBy(u => u.FirstName)
                        : filteredUsers.OrderByDescending(u => u.FirstName),
                    "lastname" => query.Ascending
                        ? filteredUsers.OrderBy(u => u.LastName)
                        : filteredUsers.OrderByDescending(u => u.LastName),
                    _ => query.Ascending
                        ? filteredUsers.OrderBy(u => u.CreatedAt)
                        : filteredUsers.OrderByDescending(u => u.CreatedAt)
                };

                var totalCount = filteredUsers.Count();
                var pagedUsers = filteredUsers
                    .Skip((query.PageNumber - 1) * query.PageSize)
                    .Take(query.PageSize)
                    .ToList();

                var userDtos = _mapper.Map<List<UserListDto>>(pagedUsers);

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
