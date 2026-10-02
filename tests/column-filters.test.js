import {
    apply_column_filters,
    distinct_values,
} from '../src/renderer/src/lib/column-filters.js'

const ROWS = [
    { app: 'web', env: 'prod', key: 'DB_PASSWORD', type: 'str' },
    { app: 'web', env: 'dev', key: 'DB_PASSWORD', type: 'str' },
    { app: 'api', env: 'prod', key: 'API_TOKEN', type: 'str' },
    { app: 'api', env: 'test', key: 'PORT', type: 'int' },
]

describe('distinct_values', () => {
    it('returns sorted unique values', () => {
        expect(distinct_values(ROWS, 'app')).toEqual(['api', 'web'])
        expect(distinct_values(ROWS, 'env')).toEqual(['dev', 'prod', 'test'])
    })

    it('keeps selected values that are no longer present', () => {
        expect(distinct_values(ROWS, 'app', ['gone'])).toEqual(
            ['api', 'gone', 'web']
        )
    })
})

describe('apply_column_filters', () => {
    it('empty filters keep every row', () => {
        expect(apply_column_filters(ROWS, { app: [], env: [], key: '' }))
            .toEqual(ROWS)
    })

    it('multi-select keeps rows whose value is selected', () => {
        const r = apply_column_filters(ROWS, { env: ['prod', 'test'] })
        expect(r.map(s => s.env)).toEqual(['prod', 'prod', 'test'])
    })

    it('combines app and env selections with AND', () => {
        const r = apply_column_filters(ROWS, { app: ['web'], env: ['prod'] })
        expect(r).toEqual([ROWS[0]])
    })

    it('text filter is a case-insensitive substring match', () => {
        const r = apply_column_filters(ROWS, { key: 'db_' })
        expect(r).toEqual([ROWS[0], ROWS[1]])
    })

    it('combines multi-select and text filters', () => {
        const r = apply_column_filters(ROWS, { app: ['api'], key: 'port' })
        expect(r).toEqual([ROWS[3]])
    })
})
