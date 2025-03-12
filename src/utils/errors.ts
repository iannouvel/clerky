import { ApiError } from '../types';
import { config } from '../config';

export class AppError extends Error {
    constructor(
        message: string,
        public code: string = 'UNKNOWN_ERROR',
        public status: number = 500
    ) {
        super(message);
        this.name = 'AppError';
    }
}

export class NetworkError extends AppError {
    constructor(message: string, status: number = 0) {
        super(message, 'NETWORK_ERROR', status);
        this.name = 'NetworkError';
    }
}

export class ValidationError extends AppError {
    constructor(message: string) {
        super(message, 'VALIDATION_ERROR', 400);
        this.name = 'ValidationError';
    }
}

export class AuthError extends AppError {
    constructor(message: string) {
        super(message, 'AUTH_ERROR', 401);
        this.name = 'AuthError';
    }
}

// Type guard to check if something is an Error
export function isError(error: unknown): error is Error {
    return error instanceof Error;
}

// Type guard to check if something is an AppError
export function isAppError(error: unknown): error is AppError {
    return error instanceof AppError;
}

// Convert any error to ApiError format
export function toApiError(error: unknown): ApiError {
    if (isAppError(error)) {
        return {
            message: error.message,
            code: error.code,
            status: error.status
        };
    }
    
    if (isError(error)) {
        return {
            message: error.message,
            code: 'UNKNOWN_ERROR',
            status: 500
        };
    }
    
    return {
        message: String(error),
        code: 'UNKNOWN_ERROR',
        status: 500
    };
}

// Retry utility with type safety
export async function withRetry<T>(
    operation: () => Promise<T>,
    options: {
        maxRetries?: number;
        baseDelay?: number;
        shouldRetry?: (error: unknown) => boolean;
    } = {}
): Promise<T> {
    const {
        maxRetries = config.retry.maxRetries,
        baseDelay = config.retry.baseDelay,
        shouldRetry = (error) => error instanceof NetworkError
    } = options;

    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await operation();
        } catch (error) {
            lastError = isError(error) ? error : new Error(String(error));

            if (attempt === maxRetries || !shouldRetry(error)) {
                throw lastError;
            }

            const delay = baseDelay * Math.pow(2, attempt);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }

    throw lastError;
} 