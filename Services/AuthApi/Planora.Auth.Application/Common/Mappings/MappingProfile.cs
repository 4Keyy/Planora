namespace Planora.Auth.Application.Common.Mappings
{
    public sealed class MappingProfile : Profile
    {
        public MappingProfile()
        {
            CreateMap<User, UserDto>()
                .ForMember(d => d.Email, opt => opt.MapFrom(s => s.Email.Value))
                .ForMember(d => d.Status, opt => opt.MapFrom(s => s.Status.ToString()));

            CreateMap<User, UserDetailDto>()
                .ForMember(d => d.Email, opt => opt.MapFrom(s => s.Email.Value))
                .ForMember(d => d.Status, opt => opt.MapFrom(s => s.Status.ToString()))
                .ForMember(d => d.RecentLogins, opt => opt.Ignore());

            CreateMap<User, UserListDto>()
                .ForMember(d => d.Email, opt => opt.MapFrom(s => s.Email.Value))
                .ForMember(d => d.Status, opt => opt.MapFrom(s => s.Status.ToString()));

            CreateMap<RefreshToken, RefreshTokenDto>();

            CreateMap<RefreshToken, RefreshTokenDetailDto>();

            CreateMap<LoginHistory, LoginHistoryDto>();

            CreateMap<LoginHistory, LoginHistoryPagedDto>()
                .ForMember(d => d.Location, opt => opt.Ignore())
                .ForMember(d => d.Device, opt => opt.Ignore())
                .ForMember(d => d.Browser, opt => opt.Ignore());

            CreateMap<RefreshToken, SessionDto>()
                .ForMember(d => d.DeviceName, opt => opt.Ignore())
                .ForMember(d => d.Browser, opt => opt.Ignore())
                .ForMember(d => d.IpAddress, opt => opt.MapFrom(s => s.CreatedByIp))
                .ForMember(d => d.Location, opt => opt.Ignore())
                .ForMember(d => d.IsCurrent, opt => opt.Ignore())
                .ForMember(d => d.LastActivityAt, opt => opt.MapFrom(s => s.CreatedAt));
        }
    }
}
