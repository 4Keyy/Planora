using AutoMapper;
using Planora.Category.Application.DTOs;
using Planora.Category.Domain.Entities;
using CategoryEntity = Planora.Category.Domain.Entities.Category;

namespace Planora.Category.Application.Features.Categories.Mappings
{
    public sealed class CategoryMappingProfile : Profile
    {
        public CategoryMappingProfile()
        {
            CreateMap<CategoryEntity, CategoryDto>()
                .ForMember(destination => destination.DisplayOrder, options => options.MapFrom(source => source.Order))
                .ReverseMap()
                .ForMember(destination => destination.Order, options => options.MapFrom(source => source.DisplayOrder));
        }
    }
}
