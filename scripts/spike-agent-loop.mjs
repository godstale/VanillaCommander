import readline from 'readline';

const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'list_files',
      description: 'List files in a directory',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'The directory path' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read the contents of a file',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'The file path' },
        },
        required: ['path'],
      },
    },
  },
];

function executeMockTool(name, args) {
  console.log(`  [Executing Tool] ${name}(${JSON.stringify(args)})`);
  if (name === 'list_files') {
    return JSON.stringify({
      files: ['package.json', 'README.md', 'src/App.tsx'],
    });
  }
  if (name === 'read_file') {
    if (args.path?.includes('package.json')) {
      return JSON.stringify({
        name: 'fortress',
        version: '0.1.0',
        description: 'Local AI agent workstation',
      });
    }
    if (args.path?.includes('README.md')) {
      return '# Fortress\nFortress is a desktop AI workstation.';
    }
    return 'File content for ' + (args.path || 'unknown');
  }
  return JSON.stringify({ error: `Unknown tool: ${name}` });
}

async function runModelSpike(modelName) {
  console.log(`\n========================================`);
  console.log(`🚀 Testing model: ${modelName}`);
  console.log(`========================================`);

  const messages = [
    {
      role: 'system',
      content:
        'You are an assistant. Always use tools to inspect files before answering. List files first, then read files if needed.',
    },
    {
      role: 'user',
      content:
        'Please list the files in "." and then read "package.json". What is the project name and version?',
    },
  ];

  let turn = 0;
  const maxTurns = 5;
  let singleToolCalled = false;
  let multiTurnSucceeded = false;
  let parallelCallSeen = false;
  let usageReported = false;
  let notes = [];

  while (turn < maxTurns) {
    turn++;
    console.log(`\n--- Turn ${turn} ---`);

    const response = await fetch(`${OLLAMA_HOST}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: modelName,
        messages,
        tools: TOOLS,
        stream: true,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error(`❌ HTTP Error: ${response.status} ${err}`);
      notes.push(`HTTP ${response.status}`);
      break;
    }

    let assistantMessage = { role: 'assistant', content: '', tool_calls: [] };
    let streamUsage = null;

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const chunk = JSON.parse(line);
          if (chunk.message?.content) {
            assistantMessage.content += chunk.message.content;
            process.stdout.write(chunk.message.content);
          }
          if (chunk.message?.tool_calls) {
            for (const tc of chunk.message.tool_calls) {
              assistantMessage.tool_calls.push(tc);
            }
          }
          if (chunk.prompt_eval_count || chunk.eval_count) {
            streamUsage = {
              promptTokens: chunk.prompt_eval_count,
              completionTokens: chunk.eval_count,
            };
          }
        } catch (e) {
          // ignore chunk parse error
        }
      }
    }

    if (streamUsage) {
      usageReported = true;
      console.log(
        `\n[Usage] prompt_tokens: ${streamUsage.promptTokens}, eval_tokens: ${streamUsage.completionTokens}`,
      );
    }

    messages.push(assistantMessage);

    if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
      singleToolCalled = true;
      if (assistantMessage.tool_calls.length > 1) {
        parallelCallSeen = true;
      }
      console.log(
        `\nReceived ${assistantMessage.tool_calls.length} tool call(s):`,
      );
      for (const tc of assistantMessage.tool_calls) {
        console.log(`Tool: ${tc.function.name}, args:`, tc.function.arguments);
        const result = executeMockTool(tc.function.name, tc.function.arguments);
        messages.push({
          role: 'tool',
          content: result,
        });
      }
    } else {
      console.log(`\nFinal answer received without tool call.`);
      if (turn >= 2 && singleToolCalled) {
        multiTurnSucceeded = true;
      }
      break;
    }
  }

  return {
    model: modelName,
    singleToolCalled,
    multiTurnSucceeded,
    parallelCallSeen,
    usageReported,
    notes: notes.join('; ') || 'OK',
  };
}

async function main() {
  const models = process.argv.slice(2);
  const targetModels =
    models.length > 0 ? models : ['qwen3.5:9b', 'granite4.1:8b', 'gemma4:12b'];

  const results = [];
  for (const m of targetModels) {
    try {
      const res = await runModelSpike(m);
      results.push(res);
    } catch (e) {
      results.push({
        model: m,
        singleToolCalled: false,
        multiTurnSucceeded: false,
        parallelCallSeen: false,
        usageReported: false,
        notes: `Exception: ${e.message}`,
      });
    }
  }

  console.log(`\n\n================ Summary Table ================`);
  console.log(
    `| 모델 | 단일 도구 호출 | 멀티턴(3턴) | 병렬 호출 | usage 보고 | 비고 |`,
  );
  console.log(`|---|---|---|---|---|---|`);
  for (const r of results) {
    console.log(
      `| ${r.model} | ${r.singleToolCalled ? 'O' : 'X'} | ${r.multiTurnSucceeded ? 'O' : 'X'} | ${r.parallelCallSeen ? 'O' : 'X'} | ${r.usageReported ? 'O' : 'X'} | ${r.notes} |`,
    );
  }
}

main();
