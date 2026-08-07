import { TechnicalKnowledgeService } from './technical-knowledge.service';

describe('TechnicalKnowledgeService', () => {
  const service = new TechnicalKnowledgeService(
    {} as ConstructorParameters<typeof TechnicalKnowledgeService>[0],
  );

  it('prioritizes tables that accept the supplied technical identifiers', () => {
    const score = service['scoreEntity'](
      {
        entity_key: 'public.catalog_items',
        schema_name: 'public',
        table_name: 'catalog_items',
        table_type: 'BASE TABLE',
        description: 'Catálogo de produtos por seller e EAN.',
        columns: [
          { name: 'fk_seller_id', type: 'uuid', nullable: false, ordinal: 1 },
          { name: 'ean', type: 'text', nullable: false, ordinal: 2 },
        ],
        relationships: [],
        code_references: [
          {
            path: 'backend/src/catalog/catalog.service.ts',
            matchCount: 4,
            lines: [20],
          },
        ],
        search_terms: ['catalog', 'produto', 'ean'],
        last_seen_run_id: 1,
        updated_at: new Date().toISOString(),
      },
      ['produto'],
      { sellerIds: ['seller'], eans: ['ean'] },
    );

    expect(score.score).toBeGreaterThanOrEqual(500);
    expect(score.reasons).toEqual(
      expect.arrayContaining([
        'aceita o seller ID informado',
        'aceita o EAN informado',
        'possui uso confirmado no backend',
      ]),
    );
  });

  it('documents relationships and confirmed backend references', () => {
    const description = service['describeTable']({
      key: 'public.orders',
      schema: 'public',
      name: 'orders',
      type: 'BASE TABLE',
      columns: [
        { name: 'id', type: 'uuid', nullable: false, ordinal: 1 },
        { name: 'fk_seller_id', type: 'uuid', nullable: false, ordinal: 2 },
      ],
      relationships: [
        {
          column: 'fk_seller_id',
          targetSchema: 'public',
          targetTable: 'sellers',
          targetColumn: 'id',
        },
      ],
      codeReferences: [
        {
          path: 'backend/src/orders/orders.service.ts',
          matchCount: 2,
          lines: [42],
        },
      ],
      description: '',
      searchTerms: [],
    });

    expect(description).toContain('public.sellers');
    expect(description).toContain('backend/src/orders/orders.service.ts');
  });

  it('retrieves both outgoing and incoming FK neighbors', async () => {
    const now = new Date().toISOString();
    const row = (
      table: string,
      relationships: Array<{
        column: string;
        targetSchema: string;
        targetTable: string;
        targetColumn: string;
      }> = [],
    ) => ({
      entity_key: `public.${table}`,
      schema_name: 'public',
      table_name: table,
      table_type: 'BASE TABLE',
      description: '',
      columns: [{ name: 'id', type: 'uuid', nullable: false, ordinal: 1 }],
      relationships,
      code_references: [],
      search_terms: table === 'orders' ? ['pedido'] : [],
      last_seen_run_id: 1,
      updated_at: now,
    });
    const entities = [
      row('orders', [
        {
          column: 'fk_seller_id',
          targetSchema: 'public',
          targetTable: 'sellers',
          targetColumn: 'id',
        },
      ]),
      row('sellers'),
      row('order_items', [
        {
          column: 'fk_order_id',
          targetSchema: 'public',
          targetTable: 'orders',
          targetColumn: 'id',
        },
      ]),
    ];
    const run = {
      id: 1,
      status: 'completed',
      schema_name: 'public',
      table_count: 3,
      relationship_count: 2,
      code_reference_count: 0,
      error: null,
      started_at: now,
      finished_at: now,
    };
    const db = {
      query: jest.fn((sql: string) =>
        Promise.resolve(
          sql.includes('ai_technical_entities')
            ? { rows: entities }
            : { rows: [run] },
        ),
      ),
    };
    const graphService = new TechnicalKnowledgeService(
      db as unknown as ConstructorParameters<
        typeof TechnicalKnowledgeService
      >[0],
    );

    const snapshot = await graphService.findRelevant({
      terms: ['pedido'],
      limit: 4,
    });

    expect(snapshot?.entities.map((entity) => entity.name)).toEqual(
      expect.arrayContaining(['orders', 'sellers', 'order_items']),
    );
  });
});
