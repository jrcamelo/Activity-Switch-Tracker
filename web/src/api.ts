import type { Entry } from './types';

class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    ...init,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {})
    }
  });

  if (!response.ok) {
    let message = response.statusText;

    try {
      const data = await response.json();
      if (typeof data?.error === 'string') {
        message = data.error;
      }
    } catch {
      if (response.status === 204) {
        message = 'Unexpected empty response';
      }
    }

    throw new ApiError(response.status, message);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

export { ApiError };

export function getCurrentSession() {
  return request<{ authenticated: true }>('/api/me', { method: 'GET' });
}

export function login(password: string) {
  return request<void>('/api/login', {
    method: 'POST',
    body: JSON.stringify({ password })
  });
}

export function logout() {
  return request<void>('/api/logout', {
    method: 'POST'
  });
}

export function getDay(date: string) {
  return request<Entry[]>(`/api/days/${date}`, { method: 'GET' });
}

export function putDay(date: string, entries: Entry[]) {
  return request<void>(`/api/days/${date}`, {
    method: 'PUT',
    body: JSON.stringify(entries)
  });
}
