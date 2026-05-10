namespace Planora.Auth.Application.Common.DTOs
{
    public sealed record ChangePasswordDto
    {
        public string CurrentPassword { get; init; } = string.Empty;

        public string NewPassword { get; init; } = string.Empty;

        public string ConfirmNewPassword { get; init; } = string.Empty;
    }
}
