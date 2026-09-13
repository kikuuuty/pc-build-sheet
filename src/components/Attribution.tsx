import type { CatalogSource } from '../api/catalog/types'

// The default notice also remains visible when showing a locally saved build.
export function Attribution({ source }: { source?: CatalogSource }) {
  return (
    <p className="attribution">
      製品データ：<a href={source?.url ?? 'https://github.com/buildcores/buildcores-open-db'} target="_blank" rel="noreferrer">{source?.name ?? 'BuildCores OpenDB'}</a>
      {' · '}<a href={source?.license_url ?? 'https://opendatacommons.org/licenses/by/1-0/'} target="_blank" rel="noreferrer">{source?.license ?? 'ODC-By 1.0'}</a>
      <span>{source?.attribution ?? 'Contains information from BuildCores OpenDB, made available under the ODC Attribution License.'}</span>
    </p>
  )
}
