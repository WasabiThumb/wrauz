# wrauz

![NPM Version](https://img.shields.io/npm/v/wrauz)
![License](https://img.shields.io/badge/license-Apache--2.0-blue)

wrauz (Web Random Access Unzip) is a low-level modern JS library for
unzipping some or all of a ZIP file's contents **without excessive memory use**.
wrauz uses the WHATWG [DecompressionStream](https://developer.mozilla.org/en-US/docs/Web/API/DecompressionStream)
API, making it light and browser compatible. It also supports ZIP64 for files
in excess of 2GB.

## Example
```js
import wrauz from "wrauz";

// Pass an ArrayBuffer, TypedArray, Blob, or URL.
// This may take a short while as wrauz needs to read the entire
// index of the ZIP, however later reads will be very fast.
const zipFile = await wrauz(`https://host.name/path/to/file.zip`);

// Find an entry in the file (null if not found)
const someEntry = zipFile.entry("path/to/file.txt");

// List entries
for (const entry of zipFile) {
    if (entry.name.endsWith('/')) continue; // directory
    
    // All of these methods will send a (range) request!
    const stream = await zipFile.read(entry); // ReadableStream<Uint8Array>
    const bytes = await zipFile.read(entry, "bytes"); // Uint8Array
    const string = await zipFile.read(entry, "utf8"); // string
}

// List entries within a directory
for (const entry of zipFile.list("ab/cd")) {
    console.log(entry.name); // ab/cd/ef, ...
}

// List entries within a directory tree
for (const entry of zipFile.list("ab/cd", true)) {
    console.log(entry.name); // ab/cd/ef, ab/cd/ef/gh, ...
}
```

## Technical Details
It is [not possible to write a robust streaming ZIP reader](https://github.com/thejoshwolfe/yauzl/blob/master/README.md#no-streaming-unzip-api)
and wrauz is not an attempt at one. Instead, it is designed such that parts
of the file which are no longer needed may be collected. If the data source
used represents a potentially large binary object (`ArrayBuffer`, `TypedArray`, `Blob`)
it is first converted into an [object URL](https://developer.mozilla.org/en-US/docs/Web/API/URL/createObjectURL_static) and then accessed exclusively via
`fetch` requests with `Range` headers ([yes, this actually works](https://developer.mozilla.org/en-US/docs/Web/URI/Reference/Schemes/blob#fetching_with_the_range_header)). If the data source is a web URL,
that URL is used directly instead.  

As an example if you were to pass a `File` into wrauz in the browser, 
it would be able to read entries off of a ZIP file on the local filesystem 
without necessitating that file be placed
entirely into memory.

Large files streamed over the web may encounter stream corruption, so wrauz
may retry to read an entry up to 3 times by sending new requests with
appropriate `Range` headers. If wrauz has determined that the endpoint server
does not support range requests, it will never recover from failed entry reads
as doing so would be incredibly punishing.

Non-browser runtimes (e.g. Bun) do not seem to implement range requests on
`blob:` URLs reliably, so expect degraded throughput when using buffers with
wrauz. If browser performance is not a concern, use a different library.

## Limitations
- wrauz does not currently support multi-disk ZIPs
- wrauz does not currently support encrypted ZIPs

## License
```text
Copyright 2026 Xavier Pedraza

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0
    
Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
```
