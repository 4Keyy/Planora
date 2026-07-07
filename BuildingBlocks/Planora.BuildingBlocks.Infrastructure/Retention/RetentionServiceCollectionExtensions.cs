namespace Planora.BuildingBlocks.Infrastructure.Retention
{
    /// <summary>
    /// DI wiring for the retention subsystem. A service calls <see cref="AddRetention"/> once (binds
    /// options + registers the scheduler) and then <see cref="AddRetentionPolicy{TPolicy}"/> for each
    /// vector it owns — e.g. TodoApi adds the completed-task and soft-delete policies, RealtimeApi adds
    /// the notification policies. Policies are singletons: they are stateless and resolve their scoped
    /// dependencies from the scope the scheduler hands them.
    /// </summary>
    public static class RetentionServiceCollectionExtensions
    {
        public static IServiceCollection AddRetention(
            this IServiceCollection services,
            IConfiguration configuration)
        {
            services.Configure<RetentionOptions>(configuration.GetSection(RetentionOptions.SectionName));
            services.AddSingleton<IRetentionLock, PostgresRetentionLock>();
            services.AddHostedService<RetentionBackgroundService>();
            return services;
        }

        public static IServiceCollection AddRetentionPolicy<TPolicy>(this IServiceCollection services)
            where TPolicy : class, IRetentionPolicy
        {
            services.AddSingleton<IRetentionPolicy, TPolicy>();
            return services;
        }
    }
}
