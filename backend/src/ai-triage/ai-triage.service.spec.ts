import { AiTriageService } from './ai-triage.service';
import { TicketAiTriageResult } from './ai-triage.dto';

describe('AiTriageService technical query fallback', () => {
  const sellerId = 'e28ef262-4240-11f1-8746-df7fb97299f3';
  const ean = '7896082900337';
  const databaseContext = {
    schema: 'public',
    tables: [
      {
        name: 'seller_events',
        type: 'BASE TABLE',
        columns: [
          { name: 'id', type: 'uuid', nullable: false },
          { name: 'fk_seller_id', type: 'uuid', nullable: false },
          { name: 'status', type: 'text', nullable: false },
        ],
      },
      {
        name: 'product_catalog',
        type: 'BASE TABLE',
        columns: [
          { name: 'id', type: 'uuid', nullable: false },
          { name: 'ean', type: 'text', nullable: false },
          { name: 'status', type: 'text', nullable: false },
        ],
      },
    ],
  };

  const createTriage = (
    diagnosticQueries: TicketAiTriageResult['diagnosticQueries'] = [],
  ): TicketAiTriageResult => ({
    tags: [],
    priority: 'media',
    shouldCreateCard: false,
    summary: '',
    symptom: '',
    likelyArea: '',
    reasoning: '',
    technicalHypothesis: '',
    evidence: [],
    relevantFiles: [],
    diagnosticQueries,
    executedQueries: [],
    codeInvestigationPaths: [],
    nextSteps: [],
    suggestedCard: { title: '', description: '', labels: [] },
    suggestedCustomerReply: '',
    similarTickets: [],
    customerQuestions: [],
    confidence: 'baixa',
  });

  const service = new AiTriageService(
    {} as ConstructorParameters<typeof AiTriageService>[0],
    {} as ConstructorParameters<typeof AiTriageService>[1],
    {} as ConstructorParameters<typeof AiTriageService>[2],
    {} as ConstructorParameters<typeof AiTriageService>[3],
  );

  it('generates separate queries when seller ID and EAN live in different tables', async () => {
    const result = await service['sanitizeCodeAnalysisResult'](
      createTriage(),
      [],
      databaseContext,
      { sellerIds: [sellerId], eans: [ean] },
    );

    expect(result.diagnosticQueries).toHaveLength(2);
    expect(
      result.diagnosticQueries.some((query) => query.sql.includes(sellerId)),
    ).toBe(true);
    expect(
      result.diagnosticQueries.some((query) => query.sql.includes(ean)),
    ).toBe(true);
  });

  it('keeps a seller query and adds the missing EAN query', async () => {
    const sellerQuery = {
      title: 'Seller',
      purpose: 'Validar seller',
      sql: `SELECT id FROM seller_events WHERE fk_seller_id = '${sellerId}' LIMIT 10`,
      expectedEvidence: 'Evento do seller',
    };
    const result = await service['sanitizeCodeAnalysisResult'](
      createTriage([sellerQuery]),
      [],
      databaseContext,
      { sellerIds: [sellerId], eans: [ean] },
    );

    expect(result.diagnosticQueries).toContainEqual(sellerQuery);
    expect(
      result.diagnosticQueries.some((query) => query.sql.includes(ean)),
    ).toBe(true);
  });

  it('reserves a query for each identifier within the three-query limit', async () => {
    const sellerTables = [1, 2, 3].map((suffix) => ({
      name: `seller_events_${suffix}`,
      type: 'BASE TABLE',
      relevanceScore: 1_000 - suffix,
      columns: [
        { name: 'id', type: 'uuid', nullable: false },
        { name: 'fk_seller_id', type: 'uuid', nullable: false },
      ],
    }));
    const result = await service['sanitizeCodeAnalysisResult'](
      createTriage(),
      [],
      {
        schema: 'public',
        tables: [...sellerTables, databaseContext.tables[1]],
      },
      { sellerIds: [sellerId], eans: [ean] },
    );

    expect(result.diagnosticQueries).toHaveLength(3);
    expect(
      result.diagnosticQueries.some((query) => query.sql.includes(sellerId)),
    ).toBe(true);
    expect(
      result.diagnosticQueries.some((query) => query.sql.includes(ean)),
    ).toBe(true);
  });

  it('allows a code-only partial result when the diagnostic database is unavailable', async () => {
    const triage = createTriage();
    triage.codeInvestigationPaths = [
      {
        path: 'backend/src/ai-triage/ai-triage.service.ts',
        symbol: 'AiTriageService',
        reason: 'Fluxo da investigação técnica.',
        check: 'Conferir o tratamento de indisponibilidade do banco.',
      },
    ];

    const problems = await service['getCodeAnalysisQualityProblems'](
      triage,
      null,
    );

    expect(problems).not.toContain('nenhum SELECT read-only foi entregue');
    expect(problems).toHaveLength(0);
  });
});
