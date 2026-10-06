import { describe, expect, it } from 'vitest';
import { isBackendPath } from './web-app';

describe('isBackendPath', () => {
  it.each(['/api', '/api/projects', '/api/auth/status', '/socket.io', '/socket.io/'])(
    'routes %s to the backend',
    (path) => {
      expect(isBackendPath(path)).toBe(true);
    },
  );

  it.each(['/', '/projects/12', '/apiary', '/api-docs', '/socket.iox', '/environments/api'])(
    'serves %s from the web app',
    (path) => {
      expect(isBackendPath(path)).toBe(false);
    },
  );
});
