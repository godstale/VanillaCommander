const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';

async function checkOllama() {
  console.log(`🔍 Checking Ollama connection at ${OLLAMA_HOST}...`);
  try {
    const response = await fetch(`${OLLAMA_HOST}/api/tags`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    const models = data.models || [];

    console.log(`✅ Ollama is running! (${models.length} model(s) available)\n`);
    if (models.length === 0) {
      console.log('⚠️  No models found. You can pull one, for example:');
      console.log('   ollama run qwen2.5-coder:7b');
      return;
    }

    console.log('Installed Models:');
    for (const m of models) {
      const sizeGB = (m.size / (1024 * 1024 * 1024)).toFixed(2);
      const modDate = m.modified_at ? new Date(m.modified_at).toLocaleString() : 'N/A';
      console.log(` - ${m.name.padEnd(25)} (${sizeGB} GB, updated: ${modDate})`);
    }
  } catch (err) {
    console.error(`\n❌ Could not connect to Ollama at ${OLLAMA_HOST}`);
    console.error(`   Error details: ${err.message}`);
    console.error('\nPlease verify that:');
    console.error(' 1. Ollama is installed (https://ollama.com)');
    console.error(' 2. The Ollama service is running (`ollama serve`)');
    console.error(' 3. Port 11434 is accessible on localhost\n');
    process.exitCode = 1;
  }
}

checkOllama();
