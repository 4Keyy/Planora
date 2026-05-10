using Planora.BuildingBlocks.Domain;
using Planora.BuildingBlocks.Domain.Exceptions;
using Planora.Todo.Domain.Enums;
using System.Text.Json;
using AppError = Planora.BuildingBlocks.Application.Models.Error;
using AppResult = Planora.BuildingBlocks.Application.Models.Result;

namespace Planora.UnitTests.BuildingBlocks;

public sealed class DomainPrimitivesTests
{
    [Fact]
    [Trait("TestType", "Unit")]
    [Trait("TestType", "Regression")]
    public void ValueObject_ShouldCompareByTypeAndEqualityComponents()
    {
        var first = new SampleValueObject("alpha", 1, null);
        var same = new SampleValueObject("alpha", 1, null);
        var differentValue = new SampleValueObject("alpha", 2, null);
        ValueObject? nullValue = null;

        Assert.True(first.Equals(same));
        Assert.True(first == same);
        Assert.False(first != same);
        Assert.False(first.Equals(differentValue));
        Assert.False(first.Equals(new OtherValueObject("alpha")));
        Assert.False(first.Equals(nullValue));
        Assert.False(first.Equals((object?)"not-a-value-object"));
        Assert.True(nullValue == null);
        Assert.False(first == nullValue);
        Assert.True(first != nullValue);
        Assert.Equal(first.GetHashCode(), same.GetHashCode());
        Assert.Equal("SampleValueObject { alpha, 1 }", first.ToString());
        Assert.NotSame(first, first.Copy());
    }

    [Fact]
    [Trait("TestType", "Unit")]
    [Trait("TestType", "Regression")]
    public void BaseEntity_ShouldManageDomainEventsLifecycleDeletionAndEquality()
    {
        var id = Guid.NewGuid();
        var entity = new SampleEntity(id);
        var sameId = new SampleEntity(id);
        var other = new SampleEntity(Guid.NewGuid());
        var domainEvent = new SampleDomainEvent(id);

        Assert.Throws<ArgumentException>(() => new SampleEntity(Guid.Empty));
        entity.AddDomainEvent(domainEvent);
        Assert.Same(domainEvent, Assert.Single(entity.DomainEvents));
        entity.RemoveDomainEvent(domainEvent);
        Assert.Empty(entity.DomainEvents);
        entity.AddDomainEvent(domainEvent);
        entity.ClearDomainEvents();
        Assert.Empty(entity.DomainEvents);

        entity.MarkAsModified(id);
        Assert.Equal(id, entity.UpdatedBy);
        Assert.NotNull(entity.UpdatedAt);
        entity.MarkAsDeleted(id);
        Assert.True(entity.IsDeleted);
        Assert.Equal(id, entity.DeletedBy);
        Assert.NotNull(entity.DeletedAt);
        entity.Restore();
        Assert.False(entity.IsDeleted);
        Assert.Null(entity.DeletedBy);
        Assert.Null(entity.DeletedAt);

        Assert.True(entity.Equals(sameId));
        Assert.True(entity == sameId);
        Assert.False(entity != sameId);
        Assert.False(entity.Equals(other));
        Assert.False(entity.Equals((BaseEntity?)null));
        Assert.False(entity.Equals("not-an-entity"));
        Assert.True((BaseEntity?)null == null);
        Assert.False(entity == null);
        Assert.True(entity != null);
        Assert.Equal(entity.GetHashCode(), sameId.GetHashCode());
    }

    [Fact]
    [Trait("TestType", "Unit")]
    [Trait("TestType", "Regression")]
    public void GenericAggregateRootAndBaseEntity_ShouldTrackIdsRowVersionAndAuditMarkers()
    {
        var created = new StringAggregate("aggregate-1");
        var defaultCreated = new DefaultStringAggregate();

        Assert.Equal("aggregate-1", created.Id);
        Assert.Empty(created.RowVersion);
        Assert.Null(defaultCreated.Id);

        created.MarkCreated("creator");
        created.MarkUpdated("updater");

        Assert.Equal("creator", created.CreatedBy);
        Assert.Equal("updater", created.UpdatedBy);
        Assert.NotNull(created.UpdatedAt);
        Assert.True(created.CreatedAt <= DateTime.UtcNow);
    }

    [Fact]
    [Trait("TestType", "Unit")]
    [Trait("TestType", "Regression")]
    public void DomainException_ShouldExposeProblemDetailsContextAndDetails()
    {
        var inner = new InvalidOperationException("inner");
        var exception = new SampleDomainException("Rule failed", "RULE_FAILED", ErrorCategory.Conflict, inner);
        exception.AddDetail("entityId", 42);

        var context = exception.ToProblemDetailsContext(
            traceId: "trace-1",
            instance: "/sample",
            userId: "user-1",
            elapsedMilliseconds: 123);

        Assert.Equal("RULE_FAILED", exception.ErrorCode);
        Assert.Equal(ErrorCategory.Conflict, exception.Category);
        Assert.Equal("Rule failed", context.Detail);
        Assert.Equal("Conflict", context.Title);
        Assert.Equal(409, context.StatusCode);
        Assert.Equal("/sample", context.Instance);
        Assert.Equal("trace-1", context.TraceId);
        Assert.Equal("user-1", context.UserId);
        Assert.Equal(123, context.ElapsedMilliseconds);
        Assert.Same(inner, context.InnerException);
        Assert.Equal(42, context.Extensions!["entityId"]);
        Assert.Contains("entityId=42", exception.ToString());

        var withoutDetails = new SampleDomainException("Missing", "MISSING", ErrorCategory.NotFound);
        Assert.Null(withoutDetails.ToProblemDetailsContext("trace", "/missing").Extensions);
    }

    [Fact]
    [Trait("TestType", "Unit")]
    [Trait("TestType", "Regression")]
    public void ConcurrencyException_ShouldExposeConflictCategoryAndEntityDetails()
    {
        var entityId = Guid.NewGuid();
        var entityConflict = new ConcurrencyException("TodoItem", entityId);
        var custom = new ConcurrencyException("Custom conflict", "CUSTOM_CONFLICT");
        var invalidValue = new InvalidValueObjectException("Money", "Amount must be positive");
        var missingByIdentifier = new EntityNotFoundException("TodoItem", "slug-1");
        var duplicate = new DuplicateEntityException("User", "Email", "user@example.com");

        Assert.Equal(ErrorCategory.Conflict, entityConflict.Category);
        Assert.Equal("CONCURRENCY.CONFLICT_ON_UPDATE", entityConflict.ErrorCode);
        Assert.Contains(entityId.ToString(), entityConflict.Message);
        Assert.Contains("EntityType=TodoItem", entityConflict.ToString());
        Assert.Contains($"EntityId={entityId}", entityConflict.ToString());
        Assert.Equal(ErrorCategory.Conflict, custom.Category);
        Assert.Equal("CUSTOM_CONFLICT", custom.ErrorCode);
        Assert.Equal("Custom conflict", custom.Message);
        Assert.Equal(ErrorCategory.Validation, invalidValue.Category);
        Assert.Equal("Money", invalidValue.Details["ValueObjectType"]);
        Assert.Equal(ErrorCategory.NotFound, missingByIdentifier.Category);
        Assert.Equal("slug-1", missingByIdentifier.Details["Identifier"]);
        Assert.Equal(ErrorCategory.Conflict, duplicate.Category);
        Assert.Equal("Email", duplicate.Details["Field"]);
    }

    [Fact]
    [Trait("TestType", "Unit")]
    [Trait("TestType", "Regression")]
    public void ProblemDetailsContext_ShouldCollectExtensionsAndValidationErrors()
    {
        var context = new ProblemDetailsContext();

        context.AddExtension("correlation", "abc");
        context.AddValidationError("Name", "Required", "Too short");

        Assert.Equal("abc", context.Extensions!["correlation"]);
        Assert.Equal(new[] { "Required", "Too short" }, context.ValidationErrors!["Name"]);
    }

    [Fact]
    [Trait("TestType", "Unit")]
    [Trait("TestType", "Regression")]
    public void ApiResponse_ShouldCreateSuccessAndFailureEnvelopesWithStableMetadata()
    {
        var success = ApiResponse<string>.Successful("payload", "corr-success");
        var failureError = Error.Validation("INVALID", "Input is invalid");
        var failure = ApiResponse<string>.Failed(failureError, "corr-failure");

        Assert.True(success.Success);
        Assert.Equal("payload", success.Data);
        Assert.Null(success.Error);
        Assert.Equal("corr-success", success.Meta.CorrelationId);
        Assert.Equal("v1", success.Meta.Version);
        Assert.True(success.Meta.Timestamp <= DateTime.UtcNow);

        Assert.False(failure.Success);
        Assert.Null(failure.Data);
        Assert.Equal(failureError, failure.Error);
        Assert.Equal("corr-failure", failure.Meta.CorrelationId);

        var successJson = JsonSerializer.Serialize(success);
        var failureJson = JsonSerializer.Serialize(failure);
        Assert.Contains("\"Data\":\"payload\"", successJson);
        Assert.DoesNotContain("\"Error\"", successJson);
        Assert.Contains("\"Error\"", failureJson);
        Assert.DoesNotContain("\"Data\"", failureJson);
    }

    [Fact]
    [Trait("TestType", "Unit")]
    [Trait("TestType", "Regression")]
    public void ApplicationResult_ShouldExposeSuccessFailureMappingTapDefaultAndMatchSemantics()
    {
        var success = AppResult.Success();
        var failureError = new AppError("ERR", "Failure");
        var failure = AppResult.Failure(failureError);
        var valued = AppResult.Success(21);
        var mapped = valued.Map(value => value * 2);
        var tapped = 0;
        var implicitValue = (Planora.BuildingBlocks.Application.Models.Result<string>)"implicit";
        var valuedFailure = AppResult.Failure<int>("NO_VALUE", "No value");

        valued.Tap(value => tapped = value);

        Assert.True(success.IsSuccess);
        Assert.False(success.IsFailure);
        Assert.True(failure.IsFailure);
        Assert.Same(failureError, failure.Error);
        Assert.Equal(21, valued.Value);
        Assert.Equal(42, mapped.Value);
        Assert.Equal(21, tapped);
        Assert.Equal("implicit", implicitValue.Value);
        Assert.Equal(7, valuedFailure.GetValueOrDefault(7));
        Assert.Equal(string.Empty, AppError.None.Code);
        Assert.Equal("Error.NullValue", AppError.NullValue.Code);
        Assert.Equal("ok:21", valued.Match(value => $"ok:{value}", error => error.Code));
        Assert.Equal("NO_VALUE", valuedFailure.Match(value => value.ToString(), error => error.Code));
        Assert.Throws<InvalidOperationException>(() => valuedFailure.Value);
        Assert.Throws<InvalidOperationException>(() => new ExposedApplicationResult(true, failureError));
        Assert.Throws<InvalidOperationException>(() => new ExposedApplicationResult(false, null));
    }

    [Fact]
    [Trait("TestType", "Unit")]
    [Trait("TestType", "Regression")]
    public void Money_ShouldNormalizeCurrencyAddSameCurrenciesAndRejectInvalidOperations()
    {
        var first = Money.Create(10.25m, "usd");
        var second = Money.Create(4.75m, "USD");
        var total = first + second;

        Assert.Equal(10.25m, first.Amount);
        Assert.Equal("USD", first.Currency);
        Assert.Equal(15m, total.Amount);
        Assert.Equal("USD", total.Currency);
        Assert.Equal(first, Money.Create(10.25m, "USD"));
        Assert.Throws<ArgumentException>(() => Money.Create(-0.01m, "USD"));
        Assert.Throws<ArgumentException>(() => Money.Create(1m, ""));
        Assert.Throws<InvalidOperationException>(() => first + Money.Create(1m, "EUR"));
    }

    [Fact]
    [Trait("TestType", "Unit")]
    [Trait("TestType", "Regression")]
    public void EmailValueObject_ShouldNormalizeCompareAndRejectInvalidAddresses()
    {
        var email = Planora.BuildingBlocks.Domain.Email.Create("USER@Example.COM");
        var same = Planora.BuildingBlocks.Domain.Email.Create("user@example.com");

        Assert.Equal("user@example.com", email.Value);
        Assert.Equal("user@example.com", email.ToString());
        Assert.Equal(same, email);
        Assert.Throws<ArgumentException>(() => Planora.BuildingBlocks.Domain.Email.Create(""));
        Assert.Throws<ArgumentException>(() => Planora.BuildingBlocks.Domain.Email.Create("not-email"));
    }

    [Theory]
    [Trait("TestType", "Unit")]
    [Trait("TestType", "Regression")]
    [InlineData(TodoPriority.VeryLow, 1, "Very Low")]
    [InlineData(TodoPriority.Low, 2, "Low")]
    [InlineData(TodoPriority.Medium, 3, "Medium")]
    [InlineData(TodoPriority.High, 4, "High")]
    [InlineData(TodoPriority.Urgent, 5, "Urgent")]
    public void TodoPriorityExtensions_ShouldMapDisplayNamesAndIntegerValues(TodoPriority priority, int value, string display)
    {
        Assert.Equal(display, priority.Display());
        Assert.Equal(priority, TodoPriorityExtensions.FromInt(value));
    }

    [Fact]
    [Trait("TestType", "Unit")]
    [Trait("TestType", "Regression")]
    public void TodoPriorityExtensions_ShouldRejectUnknownValues()
    {
        Assert.Equal("Unknown", ((TodoPriority)999).Display());
        Assert.Throws<ArgumentException>(() => TodoPriorityExtensions.FromInt(0));
        Assert.Throws<ArgumentException>(() => TodoPriorityExtensions.FromInt(6));
    }

    private sealed class SampleValueObject(string name, int order, object? optional) : ValueObject
    {
        protected override IEnumerable<object?> GetEqualityComponents()
        {
            yield return name;
            yield return order;
            yield return optional;
        }

        public SampleValueObject Copy() => Clone<SampleValueObject>();
    }

    private sealed class OtherValueObject(string name) : ValueObject
    {
        protected override IEnumerable<object?> GetEqualityComponents()
        {
            yield return name;
        }
    }

    private sealed class SampleEntity : BaseEntity
    {
        public SampleEntity(Guid id) : base(id)
        {
        }
    }

    private sealed class StringAggregate : AggregateRoot<string>
    {
        public StringAggregate(string id) : base(id)
        {
        }
    }

    private sealed class DefaultStringAggregate : AggregateRoot<string?>
    {
    }

    private sealed class ExposedApplicationResult : AppResult
    {
        public ExposedApplicationResult(bool isSuccess, AppError? error)
            : base(isSuccess, error)
        {
        }
    }

    private sealed record SampleDomainEvent(Guid EntityId) : DomainEvent;

    private sealed class SampleDomainException : DomainException
    {
        public SampleDomainException(string message, string errorCode, ErrorCategory category)
            : base(message, errorCode, category)
        {
        }

        public SampleDomainException(string message, string errorCode, ErrorCategory category, Exception innerException)
            : base(message, errorCode, category, innerException)
        {
        }
    }
}
