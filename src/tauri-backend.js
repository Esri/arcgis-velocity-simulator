/**
 * Copyright 2026 Esri
 *
 * Licensed under the Apache License Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

'use strict';

const { parseCommandLineArgs } = require('./cli-options');

if (process.argv[2] === '--tauri-probe') {
  const parsed = parseCommandLineArgs([process.argv[0], ...process.argv.slice(3)], { isPackaged: true });
  process.stdout.write(parsed.mode === 'ui' ? 'gui' : 'cli');
} else {
  process.env.VELOCITY_DESKTOP_RUNTIME = 'tauri';
  // The shared entry parses packaged arguments starting immediately after argv[0].
  process.argv.splice(1, 1);
  const host = require('./tauri-host');
  require('./main');
  host.start();
}
