import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const response = await fetch('https://api.operaios.qzz.io/api/v1/observability/metrics', {
      headers: {
        'accept': 'application/json',
        'x-internal-api-key': 'dev-secret', // Hardcoded as per prompt
      },
      // Next.js 15: avoid caching the response to ensure we always get live data
      cache: 'no-store'
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: `Failed to fetch metrics: ${response.statusText}` },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('Metrics API error:', error);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
