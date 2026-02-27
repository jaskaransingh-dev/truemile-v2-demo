const RETRY_DELAYS_MS = [5000, 15000, 60000];

function shouldRetry(status) {
  return status === 408 || status === 429 || (status >= 500 && status <= 599);
}

async function sendIngestBatch({ apiUrl, extensionKey, payload }) {
  let lastError = null;

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      const response = await fetch(`${apiUrl}/api/integrations/dat/ingest`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Extension-Key': extensionKey,
        },
        body: JSON.stringify(payload),
      });

      if (response.status === 401) {
        throw new Error('UNAUTHORIZED_EXTENSION_KEY');
      }

      if (!response.ok && shouldRetry(response.status) && attempt < RETRY_DELAYS_MS.length) {
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
        continue;
      }

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`INGEST_FAILED_${response.status}:${text}`);
      }

      return await response.json();
    } catch (error) {
      lastError = error;
      if (
        error instanceof Error &&
        error.message === 'UNAUTHORIZED_EXTENSION_KEY'
      ) {
        throw error;
      }
      if (attempt < RETRY_DELAYS_MS.length) {
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
      }
    }
  }

  throw lastError || new Error('INGEST_RETRY_EXHAUSTED');
}

window.TrueMileBackendClient = {
  sendIngestBatch,
};
