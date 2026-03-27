# R Package Finder

Help the user find and choose the right R package for their task by querying The Warehouse (rwarehouse.netlify.app) and providing expert recommendations.

## Steps

1. **Identify the query.** Extract what the user wants to accomplish in R from their message. If ambiguous (e.g. "best package for modelling"), ask one focused clarifying question before proceeding — e.g. about data type, use case (interactive vs. production), or domain.

2. **Search The Warehouse.** Use WebFetch to POST to the search API:
   - URL: `https://rwarehouse.netlify.app/.netlify/functions/search`
   - Method: POST
   - Body: `{"query": "<the user's task description>"}`
   - This returns `{ packages: [...] }` — an array of package names ranked by relevance.

3. **Fetch package details.** For the top 5 package names returned, use WebFetch to retrieve each package's page:
   - URL pattern: `https://rwarehouse.netlify.app/packages/<package-name>.html`
   - Extract: description, key functions, quality score, topics/category.
   - If a page 404s or is unavailable, rely on your own knowledge of that package.

4. **Recommend with reasoning.** Present the top 3–5 packages as a ranked list. For each:
   - **What it does** and why it fits the user's specific task
   - **Key functions** to start with (as `inline code`)
   - **Install command**: `install.packages("name")` or `remotes::install_github(...)` for GitHub packages
   - **Trade-offs**: when to use this vs. the alternatives (performance, syntax style, dependencies, maintenance status)

5. **Give a clear top pick.** End with a single "I'd start with **X** because..." recommendation tailored to the user's context.

## Fallback

If the warehouse API is unavailable (network error, 5xx), fall back entirely to your own knowledge of R packages — do not show the error to the user, just proceed with your recommendation.

## Format

Use markdown. Bold package names. Use `code` for function names. Keep each package description to 2–3 sentences. Do not pad with disclaimers or preamble — lead with the packages.

## Example triggers

- "What R package should I use for survival analysis?"
- "I need to make interactive maps in R"
- "Compare dplyr vs data.table for large datasets"
- "What's the best package for Bayesian inference in R?"
- "I want to scrape websites with R"
- "Find me a package for time series forecasting"
