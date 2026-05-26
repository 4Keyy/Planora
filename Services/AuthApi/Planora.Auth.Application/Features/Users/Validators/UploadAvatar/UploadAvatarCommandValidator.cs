using Planora.Auth.Application.Features.Users.Commands.UploadAvatar;

namespace Planora.Auth.Application.Features.Users.Validators.UploadAvatar;

public sealed class UploadAvatarCommandValidator : AbstractValidator<UploadAvatarCommand>
{
    public const long MaxFileSizeBytes = 5L * 1024 * 1024;
    public const int MinDimension = 64;
    public const int MaxDimension = 4096;

    public static readonly IReadOnlyCollection<string> AllowedContentTypes = new[]
    {
        "image/jpeg",
        "image/png",
        "image/webp",
    };

    public UploadAvatarCommandValidator()
    {
        RuleFor(x => x.File)
            .NotNull().WithMessage("File is required");

        RuleFor(x => x.File.Length)
            .GreaterThan(0).WithMessage("File is empty")
            .LessThanOrEqualTo(MaxFileSizeBytes)
            .WithMessage($"File exceeds the {MaxFileSizeBytes / (1024 * 1024)} MB limit")
            .When(x => x.File is not null);

        RuleFor(x => x.File.ContentType)
            .Must(ct => ct is not null && AllowedContentTypes.Contains(ct.ToLowerInvariant()))
            .WithMessage("Unsupported media type. Allowed: JPEG, PNG, WEBP")
            .When(x => x.File is not null);
    }
}
