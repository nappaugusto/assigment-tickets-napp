import { ConflictException } from '@nestjs/common';
import { Pool } from 'pg';
import { ApiIntegrationsService } from './api-integrations.service';

describe('ApiIntegrationsService', () => {
  const channelRow = {
    id: 3,
    user_id: 1,
    name: 'Novo canal 2',
    description: null,
    created_at: '2026-06-30T12:00:00.000Z',
    updated_at: '2026-06-30T12:00:00.000Z',
  };

  it('retries with a numbered name when the requested channel name exists', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [channelRow] });
    const service = new ApiIntegrationsService({ query } as unknown as Pool);

    const result = await service.createChannel(1, { name: 'Novo canal' });

    expect(query).toHaveBeenCalledTimes(2);
    expect(query).toHaveBeenNthCalledWith(1, expect.any(String), [
      1,
      'Novo canal',
      null,
    ]);
    expect(query).toHaveBeenNthCalledWith(2, expect.any(String), [
      1,
      'Novo canal 2',
      null,
    ]);
    expect(result).toMatchObject({ id: 3, name: 'Novo canal 2', requests: [] });
  });

  it('fails with a conflict instead of an internal error after exhausting names', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [] });
    const service = new ApiIntegrationsService({ query } as unknown as Pool);

    await expect(
      service.createChannel(1, { name: 'Novo canal' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
