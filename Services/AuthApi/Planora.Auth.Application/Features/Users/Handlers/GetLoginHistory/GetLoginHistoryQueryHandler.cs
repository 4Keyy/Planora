using Planora.Auth.Application.Features.Users.Queries.GetLoginHistory;
using Planora.BuildingBlocks.Application.Pagination;

namespace Planora.Auth.Application.Features.Users.Handlers.GetLoginHistory
{
    public sealed class GetLoginHistoryQueryHandler : IRequestHandler<GetLoginHistoryQuery, Result<PagedResult<LoginHistoryPagedDto>>>
    {
        private readonly ILoginHistoryRepository _loginHistoryRepository;
        private readonly ICurrentUserService _currentUserService;
        private readonly IMapper _mapper;
        private readonly ILogger<GetLoginHistoryQueryHandler> _logger;

        public GetLoginHistoryQueryHandler(
            ILoginHistoryRepository loginHistoryRepository,
            ICurrentUserService currentUserService,
            IMapper mapper,
            ILogger<GetLoginHistoryQueryHandler> logger)
        {
            _loginHistoryRepository = loginHistoryRepository;
            _currentUserService = currentUserService;
            _mapper = mapper;
            _logger = logger;
        }

        public async Task<Result<PagedResult<LoginHistoryPagedDto>>> Handle(
            GetLoginHistoryQuery query,
            CancellationToken cancellationToken)
        {
            try
            {
                if (!_currentUserService.UserId.HasValue)
                {
                    return Result.Failure<PagedResult<LoginHistoryPagedDto>>(
                        Error.Unauthorized("NOT_AUTHENTICATED", "User not authenticated"));
                }

                var allHistory = await _loginHistoryRepository.GetByUserIdAsync(
                    _currentUserService.UserId.Value,
                    1000,
                    cancellationToken);

                var totalCount = allHistory.Count;
                var pagedHistory = allHistory
                    .Skip((query.PageNumber - 1) * query.PageSize)
                    .Take(query.PageSize)
                    .ToList();

                var historyDtos = _mapper.Map<List<LoginHistoryPagedDto>>(pagedHistory);

                var result = new PagedResult<LoginHistoryPagedDto>(
                    historyDtos,
                    query.PageNumber,
                    query.PageSize,
                    totalCount);

                return Result.Success(result);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error retrieving login history");
                return Result.Failure<PagedResult<LoginHistoryPagedDto>>(
                    Error.InternalServer("GET_HISTORY_ERROR", "An error occurred while retrieving login history"));
            }
        }
    }
}
