using Microsoft.AspNetCore.Hosting;
using Planora.Auth.Application.Common.Interfaces;

namespace Planora.Auth.Infrastructure.Services.Common;

/// <summary>
/// Persists avatars locally under {WebRoot}/avatars/{userId}/{hash}/{size}.webp.
/// The hash subdirectory makes URLs content-addressed, so the same image deduplicates
/// and Cache-Control: immutable becomes safe (URL changes when content changes).
/// </summary>
public sealed class LocalAvatarStorage : IAvatarStorage
{
    public const string RootFolder = "avatars";

    private readonly IWebHostEnvironment _environment;
    private readonly ILogger<LocalAvatarStorage> _logger;

    public LocalAvatarStorage(
        IWebHostEnvironment environment,
        ILogger<LocalAvatarStorage> logger)
    {
        _environment = environment;
        _logger = logger;
    }

    public async Task<IAsyncDisposable> AcquireMutationLockAsync(
        Guid userId,
        CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var lockFolder = Path.Combine(ResolveUploadsRoot(), RootFolder, ".locks");
        Directory.CreateDirectory(lockFolder);
        // A fixed set of lock files avoids retaining user IDs or deleting a file another process has opened.
        var stripe = userId.ToString("N")[..2];
        var lockPath = Path.Combine(lockFolder, $"{stripe}.lock");
        while (true)
        {
            cancellationToken.ThrowIfCancellationRequested();
            try
            {
                return new FileStream(lockPath, FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None);
            }
            catch (IOException ex) when (IsLockContention(ex))
            {
                await Task.Delay(TimeSpan.FromMilliseconds(25), cancellationToken);
            }
        }
    }

    public async Task<AvatarManifest> PutAsync(
        Guid userId,
        ProcessedAvatar avatar,
        CancellationToken cancellationToken = default)
    {
        if (userId == Guid.Empty)
        {
            throw new ArgumentException("userId must be non-empty", nameof(userId));
        }

        var uploadsRoot = ResolveUploadsRoot();
        var userFolder = Path.Combine(uploadsRoot, RootFolder, userId.ToString("N"), avatar.ContentHash);
        EnsureWithinRoot(uploadsRoot, userFolder);
        Directory.CreateDirectory(userFolder);

        var urls = new Dictionary<AvatarSize, string>();
        foreach (var variant in avatar.Variants)
        {
            var fileName = $"{(int)variant.Size}.webp";
            var fullPath = Path.Combine(userFolder, fileName);
            EnsureWithinRoot(uploadsRoot, fullPath);

            // Stage each variant in the same directory so a failed write cannot truncate a published file.
            var stagedPath = Path.Combine(userFolder, $"{Guid.NewGuid():N}.tmp");
            try
            {
                await File.WriteAllBytesAsync(stagedPath, variant.Data, cancellationToken);
                File.Move(stagedPath, fullPath, overwrite: true);
            }
            finally
            {
                TryDeleteStagedFile(stagedPath, userId);
            }

            urls[variant.Size] = $"/{RootFolder}/{userId:N}/{avatar.ContentHash}/{fileName}";
        }

        return new AvatarManifest(
            SmallUrl: urls[AvatarSize.Small],
            MediumUrl: urls[AvatarSize.Medium],
            LargeUrl: urls[AvatarSize.Large],
            ContentHash: avatar.ContentHash);
    }

    public async Task DeleteAsync(Guid userId, CancellationToken cancellationToken = default)
    {
        if (userId == Guid.Empty)
        {
            return;
        }

        await using var mutationLock = await AcquireMutationLockAsync(userId, cancellationToken);
        var uploadsRoot = ResolveUploadsRoot();
        var userFolder = Path.Combine(uploadsRoot, RootFolder, userId.ToString("N"));
        EnsureWithinRoot(uploadsRoot, userFolder);

        if (Directory.Exists(userFolder))
        {
            Directory.Delete(userFolder, recursive: true);
            _logger.LogInformation("Deleted avatar tree for user {UserId}", userId);
        }
    }

    public void PruneOldRevisions(Guid userId, string keepHash)
    {
        try
        {
            var uploadsRoot = ResolveUploadsRoot();
            var userFolder = Path.Combine(uploadsRoot, RootFolder, userId.ToString("N"));
            if (!Directory.Exists(userFolder)) return;

            foreach (var dir in Directory.EnumerateDirectories(userFolder))
            {
                var name = Path.GetFileName(dir);
                if (!string.Equals(name, keepHash, StringComparison.Ordinal))
                {
                    Directory.Delete(dir, recursive: true);
                }
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to prune old avatar revisions for {UserId}", userId);
        }
    }

    private void TryDeleteStagedFile(string path, Guid userId)
    {
        try
        {
            File.Delete(path);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            _logger.LogWarning(ex, "Failed to remove staged avatar file for {UserId}", userId);
        }
    }

    private static bool IsLockContention(IOException exception) =>
        // FileShare.None reports a Windows sharing violation or Unix EWOULDBLOCK.
        OperatingSystem.IsWindows() ? exception.HResult == unchecked((int)0x80070020) :
        OperatingSystem.IsMacOS() ? exception.HResult == 35 : exception.HResult == 11;

    private string ResolveUploadsRoot()
    {
        var webRoot = _environment.WebRootPath;
        if (!string.IsNullOrWhiteSpace(webRoot))
        {
            return webRoot;
        }
        return Path.Combine(_environment.ContentRootPath, "wwwroot");
    }

    private static void EnsureWithinRoot(string root, string candidate)
    {
        var absoluteRoot = Path.GetFullPath(root)
            .TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
        var absoluteCandidate = Path.GetFullPath(candidate);
        if (!absoluteCandidate.StartsWith(absoluteRoot, StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException("Avatar path escapes uploads root");
        }
    }
}
