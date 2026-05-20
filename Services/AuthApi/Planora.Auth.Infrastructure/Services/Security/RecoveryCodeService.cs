using Planora.Auth.Application.Common.Interfaces;
using Planora.Auth.Domain.Entities;
using Planora.Auth.Domain.Repositories;
using System.Security.Cryptography;

namespace Planora.Auth.Infrastructure.Services.Security;

public sealed class RecoveryCodeService : IRecoveryCodeService
{
    private const int CodeCount = 10;
    private const string Alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

    private readonly IAuthUnitOfWork _unitOfWork;
    private readonly IPasswordHasher _passwordHasher;
    private readonly ILogger<RecoveryCodeService> _logger;

    public RecoveryCodeService(
        IAuthUnitOfWork unitOfWork,
        IPasswordHasher passwordHasher,
        ILogger<RecoveryCodeService> logger)
    {
        _unitOfWork = unitOfWork;
        _passwordHasher = passwordHasher;
        _logger = logger;
    }

    public async Task<IReadOnlyList<string>> GenerateAndStoreCodesAsync(
        Guid userId,
        CancellationToken cancellationToken = default)
    {
        // Remove any existing codes for this user
        await _unitOfWork.RecoveryCodes.DeleteAllForUserAsync(userId, cancellationToken);

        var plaintext = new List<string>(CodeCount);
        for (var i = 0; i < CodeCount; i++)
        {
            var code = GenerateCode();
            plaintext.Add(code);

            var hash = _passwordHasher.HashPassword(code);
            var entity = new UserRecoveryCode(userId, hash);
            await _unitOfWork.RecoveryCodes.AddAsync(entity, cancellationToken);
        }

        await _unitOfWork.SaveChangesAsync(cancellationToken);

        _logger.LogInformation("Generated {Count} recovery codes for user {UserId}", CodeCount, userId);

        return plaintext.AsReadOnly();
    }

    public async Task<bool> ValidateAndConsumeCodeAsync(
        Guid userId,
        string code,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(code))
            return false;

        var unused = await _unitOfWork.RecoveryCodes.GetUnusedByUserIdAsync(userId, cancellationToken);

        foreach (var rc in unused)
        {
            if (_passwordHasher.VerifyPassword(code.ToUpperInvariant(), rc.CodeHash))
            {
                rc.MarkAsUsed();
                _unitOfWork.RecoveryCodes.Update(rc);
                await _unitOfWork.SaveChangesAsync(cancellationToken);

                _logger.LogWarning("Recovery code consumed for user {UserId}", userId);
                return true;
            }
        }

        return false;
    }

    private static string GenerateCode()
    {
        var chars = new char[10];
        for (var i = 0; i < chars.Length; i++)
            chars[i] = Alphabet[RandomNumberGenerator.GetInt32(Alphabet.Length)];

        return $"{new string(chars, 0, 5)}-{new string(chars, 5, 5)}";
    }
}
