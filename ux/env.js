/*
 * Copyright 2026 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
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

/* Says where this page is running.

   This copy is the one a plain web server sends: there is no Studio server behind the page, so the app runs on demo
   data. The Studio server (ax-studio) answers /env.js itself and sets window.AX_STUDIO, which switches the app to
   real data from AX. See live.js. */
window.AX_STUDIO = null;
