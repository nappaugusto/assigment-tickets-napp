import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { MovideskTicketsClient } from './movidesk-tickets.client';

jest.mock('axios', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    patch: jest.fn(),
  },
}));

const mockedAxios = axios as jest.Mocked<typeof axios>;

function createConfig(
  overrides: Record<string, string | number> = {},
): ConfigService {
  const values: Record<string, string | number> = {
    MOVIDESK_API_URL: 'https://api.movidesk.com/public/v1/tickets',
    MOVIDESK_PERSONS_API_URL: 'https://api.movidesk.com/public/v1/persons',
    MOVIDESK_API_TOKEN: 'token-123',
    MOVIDESK_API_TIMEOUT: 1000,
    MOVIDESK_PERSONS_CACHE_SECONDS: 300,
    MOVIDESK_PERSONS_PAGE_SIZE: 200,
    MOVIDESK_PERSONS_MAX_PAGES: 10,
    MOVIDESK_PERSONS_QUERY_PARAMS:
      "$filter=profileType eq 1&$select=businessName,profileType,isActive,teams",
    ASSIGNMENT_TEAM_NAMES: 'Minha Equipe,Time Especial',
    ...overrides,
  };

  return {
    get: (key: string) => values[key],
  } as ConfigService;
}

describe('MovideskTicketsClient', () => {
  beforeEach(() => {
    mockedAxios.get.mockReset();
    mockedAxios.patch.mockReset();
  });

  it('assigns using the default email from the emails array', async () => {
    mockedAxios.get.mockResolvedValue({
      data: [
        {
          businessName: 'Maria Silva',
          profileType: 1,
          isActive: true,
          teams: [{ name: 'Minha Equipe' }],
          emails: [
            { email: 'maria.secundario@napp.com', isDefault: false },
            { email: 'maria.silva@napp.com', isDefault: true },
          ],
        },
      ],
    });
    mockedAxios.patch.mockResolvedValue({ data: {} });

    const client = new MovideskTicketsClient(createConfig());

    await client.assign(123, 'Maria Silva', 'Minha Equipe');

    expect(mockedAxios.get).toHaveBeenCalledWith(
      'https://api.movidesk.com/public/v1/persons',
      expect.objectContaining({
        params: expect.objectContaining({
          token: 'token-123',
          $filter: 'profileType eq 1',
          $skip: '0',
          $top: '200',
        }),
      }),
    );

    const select = String(mockedAxios.get.mock.calls[0][1]?.params?.['$select']);
    expect(select.split(',')).toEqual(
      expect.arrayContaining([
        'businessName',
        'email',
        'emails',
        'profileType',
        'isActive',
        'teams',
      ]),
    );

    expect(mockedAxios.patch).toHaveBeenCalledWith(
      'https://api.movidesk.com/public/v1/tickets',
      {
        owner: { id: 'maria.silva@napp.com' },
        ownerTeam: 'Minha Equipe',
      },
      expect.objectContaining({
        params: { token: 'token-123', id: 123 },
      }),
    );
  });

  it('refreshes the cache on miss and resolves the responsible name', async () => {
    mockedAxios.get
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({
        data: [
          {
            businessName: 'Joao Souza',
            email: 'joao.souza@napp.com',
            profileType: 1,
            isActive: true,
            teams: [{ name: 'Time Especial' }],
          },
        ],
      });
    mockedAxios.patch.mockResolvedValue({ data: {} });

    const client = new MovideskTicketsClient(createConfig());

    await client.assign(456, 'Joao Souza', 'Minha Equipe');

    expect(mockedAxios.get).toHaveBeenCalledTimes(2);
    expect(mockedAxios.patch).toHaveBeenCalledWith(
      'https://api.movidesk.com/public/v1/tickets',
      {
        owner: { id: 'joao.souza@napp.com' },
        ownerTeam: 'Time Especial',
      },
      expect.objectContaining({
        params: { token: 'token-123', id: 456 },
      }),
    );
  });

  it('assigns directly when the responsible value is an e-mail', async () => {
    mockedAxios.patch.mockResolvedValue({ data: {} });

    const client = new MovideskTicketsClient(createConfig());

    await client.assign(789, 'ana.lima@napp.com', 'Minha Equipe');

    expect(mockedAxios.get).not.toHaveBeenCalled();
    expect(mockedAxios.patch).toHaveBeenCalledWith(
      'https://api.movidesk.com/public/v1/tickets',
      {
        owner: { id: 'ana.lima@napp.com' },
        ownerTeam: 'Minha Equipe',
      },
      expect.objectContaining({
        params: { token: 'token-123', id: 789 },
      }),
    );
  });

  it('uses stale people cache when refreshing people fails', async () => {
    mockedAxios.get
      .mockResolvedValueOnce({
        data: [
          {
            businessName: 'Maria Silva',
            email: 'maria.silva@napp.com',
            profileType: 1,
            isActive: true,
            teams: [{ name: 'Minha Equipe' }],
          },
        ],
      })
      .mockRejectedValueOnce(new Error('Movidesk unavailable'));
    mockedAxios.patch.mockResolvedValue({ data: {} });

    const client = new MovideskTicketsClient(
      createConfig({ MOVIDESK_PERSONS_CACHE_SECONDS: 0 }),
    );

    await client.assign(123, 'Maria Silva', 'Minha Equipe');
    await client.assign(124, 'Maria Silva', 'Minha Equipe');

    expect(mockedAxios.get).toHaveBeenCalledTimes(2);
    expect(mockedAxios.patch).toHaveBeenLastCalledWith(
      'https://api.movidesk.com/public/v1/tickets',
      {
        owner: { id: 'maria.silva@napp.com' },
        ownerTeam: 'Minha Equipe',
      },
      expect.objectContaining({
        params: { token: 'token-123', id: 124 },
      }),
    );
  });
});
