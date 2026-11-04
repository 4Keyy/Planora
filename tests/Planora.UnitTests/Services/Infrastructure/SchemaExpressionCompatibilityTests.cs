using Planora.BuildingBlocks.Infrastructure.Persistence;

namespace Planora.UnitTests.Services.Infrastructure;

public sealed class SchemaExpressionCompatibilityTests
{
    private const string Active = "\"Status\" IN ('Pending','Failed')";

    [Theory]
    [InlineData("(((\"Status\")::integer)::text = ANY (ARRAY['Pending'::text, 'Failed'::text]))")]
    [InlineData("((\"Status\")::boolean)::text = ANY (ARRAY['Pending'::text, 'Failed'::text])")]
    [InlineData("\"Status\" IN ('Pending','Failed') OR true")]
    [InlineData("\"Status\" IN ('pending','failed')")]
    [InlineData("\"Status\" IN ('Pending')")]
    [InlineData("\"Status\" IN ('Pending','Failed') AND false")]
    public void ChangedPredicate_IsNotEquivalent(string actual) =>
        Assert.False(PostgreSqlSchemaCompatibility.EquivalentExpression(Active, actual));

    [Theory]
    [InlineData("((\"Status\")::text = ANY ((ARRAY['Pending'::character varying, 'Failed'::character varying])::text[]))")]
    [InlineData("\"Status\" IN ('Pending', 'Failed')")]
    public void ReviewedActivePredicate_AcceptsItsPostgresRendering(string actual) =>
        Assert.True(PostgreSqlSchemaCompatibility.EquivalentExpression(Active, actual));

    [Theory]
    [InlineData("FALSE", "(false)")]
    [InlineData("'value'", "'value'::text")]
    [InlineData("42", "(42)::integer")]
    [InlineData("NOW()", "now()")]
    public void TrustedLiteralAndBuiltinFormatting_IsEquivalent(string expected, string actual) =>
        Assert.True(PostgreSqlSchemaCompatibility.EquivalentExpression(expected, actual));

    [Theory]
    [InlineData("'value::text'", "'value'")]
    [InlineData("'Value'", "'value'")]
    [InlineData("'123'", "('123'::integer)::text")]
    [InlineData("now()", "public.now()")]
    [InlineData("'abc'", "('abc'::character varying(1))")]
    public void ChangedLiteralOrFunction_IsNotEquivalent(string expected, string actual) =>
        Assert.False(PostgreSqlSchemaCompatibility.EquivalentExpression(expected, actual));
}
