namespace Planora.Auth.Infrastructure.Services.Common
{
    public sealed class DateTimeService : IDateTime
    {
        public DateTime UtcNow => DateTime.UtcNow;
    }
}
