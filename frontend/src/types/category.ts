export type Category = {
  id: string
  name: string
  description?: string | null
  color?: string | null
  icon?: string | null
  displayOrder?: number | null
}

export type CategoryListResponse = Category[] | { items?: Category[] | null }

export function toCategoryList(data: CategoryListResponse | null | undefined): Category[] {
  if (Array.isArray(data)) return data
  return data?.items ?? []
}
