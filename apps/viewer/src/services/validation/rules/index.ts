/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { ValidationRule } from '../types';
import { SCHEMA_RULES } from './schema';
import { GEOREFERENCING_RULES } from './georeferencing';
import { HIERARCHY_RULES } from './hierarchy';

export const DEFAULT_RULES: ValidationRule[] = [
  ...SCHEMA_RULES,
  ...GEOREFERENCING_RULES,
  ...HIERARCHY_RULES,
];

export { SCHEMA_RULES, GEOREFERENCING_RULES, HIERARCHY_RULES };
