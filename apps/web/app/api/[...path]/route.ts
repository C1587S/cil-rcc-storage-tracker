/**
 * API Proxy Route
 *
 * Proxies requests to the backend API with extended timeout for large responses.
 * This replaces Next.js rewrites which have fixed 30s timeout.
 */

import { NextRequest, NextResponse } from 'next/server'

const API_URL = process.env.API_URL || 'http://localhost:8000'
const API_TIMEOUT = 60000 // 60 seconds - reduced from 180s for faster failure feedback

export async function GET(
  request: NextRequest,
  { params }: { params: { path: string[] } }
) {
  return proxyRequest(request, params.path)
}

export async function POST(
  request: NextRequest,
  { params }: { params: { path: string[] } }
) {
  return proxyRequest(request, params.path)
}

export async function PUT(
  request: NextRequest,
  { params }: { params: { path: string[] } }
) {
  return proxyRequest(request, params.path)
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { path: string[] } }
) {
  return proxyRequest(request, params.path)
}

async function proxyRequest(request: NextRequest, pathSegments: string[]) {
  try {
    const path = pathSegments.join('/')
    const searchParams = request.nextUrl.searchParams.toString()
    const url = `${API_URL}/api/${path}${searchParams ? `?${searchParams}` : ''}`

    console.log(`[API Proxy] ${request.method} ${url}`)

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT)

    try {
      const headers: HeadersInit = {}

      // Forward relevant headers
      const contentType = request.headers.get('content-type')
      if (contentType) {
        headers['content-type'] = contentType
      }

      const options: RequestInit = {
        method: request.method,
        headers,
        signal: controller.signal,
      }

      // Include body for POST/PUT requests
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        options.body = await request.text()
      }

      const response = await fetch(url, options)
      clearTimeout(timeoutId)

      // Forward response
      const data = await response.text()

      return new NextResponse(data, {
        status: response.status,
        headers: {
          'content-type': response.headers.get('content-type') || 'application/json',
        },
      })
    } catch (error: any) {
      clearTimeout(timeoutId)

      if (error.name === 'AbortError') {
        console.error(`[API Proxy] Timeout after ${API_TIMEOUT}ms: ${url}`)
        return NextResponse.json(
          { error: 'Request timeout - query took too long' },
          { status: 504 }
        )
      }

      throw error
    }
  } catch (error: any) {
    console.error('[API Proxy] Error:', error)
    return NextResponse.json(
      { error: error.message || 'Proxy error' },
      { status: 500 }
    )
  }
}
