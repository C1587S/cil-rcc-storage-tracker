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
    // Request interceptor for logging
    this.client.interceptors.request.use(
      (config) => {
        const fullUrl = `${config.baseURL}${config.url}`
        console.log('[ApiClient] Making request:', {
          method: config.method?.toUpperCase(),
          url: fullUrl,
          params: config.params
        })
        return config
      },
      (error) => Promise.reject(error)
    )

    // Response interceptor for error handling
    this.client.interceptors.response.use(
      (response) => {
        console.log('[ApiClient] Response received:', {
          url: response.config.url,
          status: response.status,
          dataKeys: Object.keys(response.data || {})
        })
        return response
      },
      (error: AxiosError<ApiError>) => {
        if (error.response) {
          console.error('[ApiClient] Error response:', {
            url: error.config?.url,
            status: error.response.status,
            detail: error.response.data?.detail
          })
          const apiError: ApiError = {
            detail: error.response.data?.detail || error.message,
            status_code: error.response.status,
          }
          return Promise.reject(apiError)
        }
        console.error('[ApiClient] Network error:', error.message)
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
