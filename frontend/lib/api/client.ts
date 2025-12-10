import axios, { AxiosInstance, AxiosError } from 'axios'
import type { ApiError } from '@/lib/types'

class ApiClient {
  private client: AxiosInstance

  constructor() {
    this.client = axios.create({
      baseURL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000',
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
      },
    })

    this.setupInterceptors()
  }

  private setupInterceptors() {
    this.client.interceptors.response.use(
      (response) => response,
      (error: AxiosError<ApiError>) => {
        if (error.response) {
          const apiError: ApiError = {
            detail: error.response.data?.detail || error.message,
            status_code: error.response.status,
          }
          return Promise.reject(apiError)
        }
        return Promise.reject({
          detail: 'Network error. Please check your connection.',
          status_code: 0,
        } as ApiError)
      }
    )
  }

  get<T>(url: string, params?: Record<string, unknown>): Promise<T> {
    return this.client.get<T>(url, { params }).then((res) => res.data)
  }

  post<T>(url: string, data?: unknown): Promise<T> {
    return this.client.post<T>(url, data).then((res) => res.data)
  }

  put<T>(url: string, data?: unknown): Promise<T> {
    return this.client.put<T>(url, data).then((res) => res.data)
  }

  delete<T>(url: string): Promise<T> {
    return this.client.delete<T>(url).then((res) => res.data)
  }
}

export const apiClient = new ApiClient()
