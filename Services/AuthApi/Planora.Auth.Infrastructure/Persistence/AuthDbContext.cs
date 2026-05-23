using Planora.Auth.Infrastructure.Auditing;
using Planora.BuildingBlocks.Infrastructure.Inbox;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.EntityFrameworkCore.Metadata;
using Planora.BuildingBlocks.Domain;
using System.Security.Cryptography;

namespace Planora.Auth.Infrastructure.Persistence;

public sealed class AuthDbContext : DbContext, IApplicationDbContext
{
    private readonly IDomainEventDispatcher _domainEventDispatcher;
    private readonly IDataProtectionProvider? _dataProtectionProvider;

    public AuthDbContext(
        DbContextOptions<AuthDbContext> options,
        IDomainEventDispatcher domainEventDispatcher,
        IDataProtectionProvider? dataProtectionProvider = null)
        : base(options)
    {
        _domainEventDispatcher = domainEventDispatcher;
        _dataProtectionProvider = dataProtectionProvider;
    }

    public DbSet<User> Users => Set<User>();
    public DbSet<global::Planora.Auth.Domain.Entities.Role> Roles => Set<global::Planora.Auth.Domain.Entities.Role>();
    public DbSet<UserRole> UserRoles => Set<UserRole>();
    public DbSet<RefreshToken> RefreshTokens => Set<RefreshToken>();
    public DbSet<LoginHistory> LoginHistory => Set<LoginHistory>();
    public DbSet<Friendship> Friendships => Set<Friendship>();
    public DbSet<AuditLog> AuditLogs => Set<AuditLog>();
    public DbSet<PasswordHistory> PasswordHistory => Set<PasswordHistory>();
    public DbSet<UserRecoveryCode> UserRecoveryCodes => Set<UserRecoveryCode>();
    public DbSet<InboxMessage> InboxMessages => Set<InboxMessage>();
    public DbSet<OutboxMessage> OutboxMessages => Set<OutboxMessage>();

    protected override void OnConfiguring(DbContextOptionsBuilder optionsBuilder)
    {
        optionsBuilder.ConfigureWarnings(warnings =>
            warnings.Ignore(RelationalEventId.PendingModelChangesWarning));
        base.OnConfiguring(optionsBuilder);
    }

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);
        modelBuilder.ApplyConfigurationsFromAssembly(Assembly.GetExecutingAssembly());
        ApplyTotpSecretEncryption(modelBuilder);

        // Optimistic concurrency for the Friendship aggregate (pending/accepted
        // state machine) via PostgreSQL's xmin system column. Guarded so the
        // InMemory test provider is unaffected.
        if (Database.IsNpgsql())
        {
            modelBuilder.Entity<Friendship>()
                .Property<uint>("xmin")
                .HasColumnName("xmin")
                .HasColumnType("xid")
                .ValueGeneratedOnAddOrUpdate()
                .IsConcurrencyToken();
        }
    }

    private void ApplyTotpSecretEncryption(ModelBuilder modelBuilder)
    {
        if (_dataProtectionProvider is null) return;

        var protector = _dataProtectionProvider.CreateProtector("Planora.TwoFactorSecret.v1");
        modelBuilder.Entity<User>()
            .Property(u => u.TwoFactorSecret)
            .HasConversion(
                v => v == null ? null : protector.Protect(v),
                v => UnprotectSafe(protector, v));
    }

    private static string? UnprotectSafe(IDataProtector protector, string? value)
    {
        if (value is null) return null;
        try { return protector.Unprotect(value); }
        catch (CryptographicException) { return null; }
    }

    public override async Task<int> SaveChangesAsync(CancellationToken cancellationToken = default)
    {
        var domainEntities = ChangeTracker
            .Entries<BaseEntity>()
            .Where(x => x.Entity.DomainEvents.Any())
            .Select(x => x.Entity)
            .ToList();

        var domainEvents = domainEntities
            .SelectMany(x => x.DomainEvents)
            .ToList();

        domainEntities.ForEach(entity => entity.ClearDomainEvents());

        var result = await base.SaveChangesAsync(cancellationToken);

        foreach (var domainEvent in domainEvents)
        {
            await _domainEventDispatcher.DispatchAsync(domainEvent, cancellationToken);
        }

        return result;
    }
}
