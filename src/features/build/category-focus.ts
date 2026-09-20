import { createRef, useState } from 'react'
import { optionalCategories } from '../../domain/categories'

export function useOptionalCategoryFocus() {
  // Shared by the sheet and sidebar; survives optional rows/buttons being removed.
  const [targets] = useState(() => new Map(optionalCategories.map(({ id }) => [id, {
    product: createRef<HTMLButtonElement>(), add: createRef<HTMLButtonElement>(),
  }])))
  return targets
}

export type OptionalCategoryFocus = ReturnType<typeof useOptionalCategoryFocus>
