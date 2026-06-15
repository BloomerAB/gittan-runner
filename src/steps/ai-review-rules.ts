export type TRule = {
  readonly pattern: RegExp
  readonly file: RegExp
  readonly message: string
  readonly suggestion: string
  readonly severity: "critical" | "warning"
  readonly category: "tooling" | "security" | "architecture"
}

export const AI_PRODUCT_RULES: ReadonlyArray<TRule> = [
  // --- Right-tooling for AI ---
  {
    pattern: /["']langchain["']|from langchain/,
    file: /package\.json|requirements|\.py$|\.ts$/,
    message: "LangChain adds massive abstraction over simple API calls. In most cases you're wrapping a 5-line HTTP call in 500 lines of framework.",
    suggestion: "Call the LLM API directly. Anthropic SDK, OpenAI SDK, or plain HTTP. You'll understand what's happening and debug faster.",
    severity: "warning",
    category: "tooling",
  },
  {
    pattern: /["']llama-index["']|["']llama_index["']|from llama_index/,
    file: /package\.json|requirements|\.py$/,
    message: "LlamaIndex adds complexity for simple RAG pipelines. Consider if you need it.",
    suggestion: "For basic RAG: embed documents, store in a vector DB, retrieve top-k, pass to LLM. That's 50 lines, not a framework.",
    severity: "warning",
    category: "tooling",
  },
  {
    pattern: /["']chromadb["']|["']pinecone["']|["']weaviate["']/,
    file: /package\.json|requirements|\.py$|\.ts$/,
    message: "Dedicated vector database detected. Do you need a separate database for this?",
    suggestion: "PostgreSQL with pgvector, SQLite with sqlite-vss, or ScyllaDB with vector search handle most vector use cases without adding another database to operate.",
    severity: "warning",
    category: "architecture",
  },

  // --- AI Security ---
  {
    pattern: /user.*input.*prompt|prompt.*\+.*user|`\$\{.*user.*\}.*prompt|f["'].*\{.*input/,
    file: /\.ts$|\.js$|\.py$/,
    message: "User input interpolated directly into LLM prompt — prompt injection risk.",
    suggestion: "Sanitize user input before including in prompts. Use system prompts for instructions, user messages for data. Never let user input control the system prompt.",
    severity: "critical",
    category: "security",
  },
  {
    pattern: /eval\(.*response|exec\(.*response|Function\(.*response/,
    file: /\.ts$|\.js$|\.py$/,
    message: "LLM response executed as code — critical injection risk.",
    suggestion: "Never execute LLM output directly. Parse structured output (JSON schema), validate it, then act on the parsed data.",
    severity: "critical",
    category: "security",
  },
  {
    pattern: /api[_-]?key.*=.*["']sk-|openai.*key.*=.*["']/i,
    file: /\.ts$|\.js$|\.py$|\.env/,
    message: "Hardcoded LLM API key.",
    suggestion: "Use environment variables or a secrets manager. Never commit API keys.",
    severity: "critical",
    category: "security",
  },
  {
    pattern: /\.send\(.*response\.text|res\.send\(.*completion|return.*llm.*output/,
    file: /\.ts$|\.js$|\.py$/,
    message: "LLM response returned directly to user without sanitization.",
    suggestion: "Sanitize LLM output before displaying to users. LLMs can output HTML, scripts, or misleading content.",
    severity: "warning",
    category: "security",
  },

  // --- AI Architecture ---
  {
    pattern: /temperature.*[=:].*[01]\.[5-9]|temperature.*[=:].*1\.0/,
    file: /\.ts$|\.js$|\.py$/,
    message: "High temperature (>0.5) in production code. This makes output unpredictable.",
    suggestion: "Use temperature 0-0.3 for production. High temperature is for creative/experimental use, not reliable applications.",
    severity: "warning",
    category: "architecture",
  },
  {
    pattern: /max_tokens.*[=:].*\d{5,}|maxTokens.*[=:].*\d{5,}/,
    file: /\.ts$|\.js$|\.py$/,
    message: "Very high max_tokens. This increases cost and latency.",
    suggestion: "Set max_tokens to the minimum needed for your use case. Most responses don't need 10k+ tokens.",
    severity: "warning",
    category: "architecture",
  },
  {
    pattern: /model.*["']gpt-3\.5|model.*["']gpt-4["'](?!-)/,
    file: /\.ts$|\.js$|\.py$/,
    message: "Using deprecated or non-specific model ID.",
    suggestion: "Pin to a specific model version (e.g., gpt-4o-2024-08-06, claude-sonnet-4-20250514) for reproducibility.",
    severity: "warning",
    category: "architecture",
  },
  {
    pattern: /retry.*loop|while.*true.*api|for.*range.*retry/,
    file: /\.ts$|\.js$|\.py$/,
    message: "Manual retry loop for LLM API calls.",
    suggestion: "Use the SDK's built-in retry logic or exponential backoff. Manual loops often miss rate limit headers.",
    severity: "warning",
    category: "architecture",
  },
  {
    pattern: /cache.*=.*{}|cache.*=.*new Map|@cache|@lru_cache/,
    file: /\.ts$|\.js$|\.py$/,
    message: "In-memory LLM response cache. This doesn't survive restarts and doesn't scale.",
    suggestion: "If caching LLM responses, use a persistent store with TTL. Consider if caching is needed at all — deterministic prompts with temperature 0 give consistent results.",
    severity: "warning",
    category: "architecture",
  },
]
