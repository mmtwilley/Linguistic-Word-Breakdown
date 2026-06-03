export class TimeoutError extends Error {
  constructor() {
    super('Request took too long (30s). Please try again.');
    this.name = 'TimeoutError';
  }
}

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export class NetworkError extends Error {
  constructor(message) {
    super(message || 'Network error. Check your internet connection and try again.');
    this.name = 'NetworkError';
  }
}

export class JsonError extends Error {
  constructor(message) {
    super(message || 'Unexpected response format. Please retry.');
    this.name = 'JsonError';
  }
}

export class ValidationError extends Error {
  constructor(field, message) {
    super(message || 'Incomplete response. Please retry.');
    this.name = 'ValidationError';
    this.field = field;
  }
}

export class StorageError extends Error {
  constructor(message) {
    super(message || 'Storage write failed.');
    this.name = 'StorageError';
  }
}
