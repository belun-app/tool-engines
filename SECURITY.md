# Security policy

## Supported versions

Security fixes are released for the latest published version only.

## Scope

The engines are written for one user working on their own files in a browser tab. They
validate their input and report errors, but they are not hardened for unbounded,
untrusted input on a server: some parsers allocate in proportion to the input, and a
crafted document can still take noticeable time. If you run a module on input from other
people (a server, a queue worker, a shared service), cap the input size first (for
example a few megabytes for PDFs and far less for text formats), run it in a worker or
separate process with a timeout, and treat its output (HTML, Markdown, SVG, XML) as
untrusted when you embed it in a page. Regular expressions supplied by a user
(`dev/regex-tester`) can backtrack catastrophically; run them in a worker that you
can terminate.

Reports about hangs or quadratic slowdowns on moderately sized input, crashes, unescaped
output, or prototype pollution are in scope and welcome.

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub's private vulnerability
reporting: open the **Security** tab of this repository and choose **Report a
vulnerability** (direct link:
<https://github.com/belun-app/tool-engines/security/advisories/new>).

Do not open a public issue for a security problem.

Useful details: the affected module and version, an input that triggers the problem,
and what an attacker could achieve (for example a crash or hang on a crafted PDF, or
unescaped output from an HTML or XML generator).

You should get a first reply within 7 days. Once a fix is released, the advisory is
published with credit to the reporter unless you ask otherwise.
