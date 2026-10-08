export interface FormulaCellCoordinate {
	rowId: string;
	colField: string;
}

const NO_CACHED_FORMULA_VALUE: { hasCached: boolean; value: unknown } = Object.freeze({ hasCached: false, value: undefined });

const NO_CELLS: FormulaCellCoordinate[] = [];

export class DagEngine {
	private dependents = new Map<string, Set<string>>(); // dependencyKey -> Set of dependentKeys
	private dependencies = new Map<string, Set<string>>(); // dependentKey -> Set of dependencyKeys
	private cache = new Map<string, unknown>(); // cellKey -> computedValue
	private formulas = new Map<string, string>(); // cellKey -> formulaString
	private dirty = new Set<string>(); // Set of dirty cellKeys
	private isEvaluating = new Set<string>(); // Reentrancy protection tracker
	/**
	 * colField -> number of registered formulas in that column. Lets the per-cell lookups on the
	 * render/bind path answer "no formula" without building a composite key string.
	 * The value cache only ever holds formula cells, so this gates cache lookups too.
	 */
	private formulaCountByField = new Map<string, number>();

	/**
	 * Register or update a formula for a specific cell coordinate.
	 * Checks for circular references before applying the formula.
	 */
	public registerFormula(rowId: string, colField: string, formula: string): void {
		const targetKey = this.getCellKey(rowId, colField);

		// Extract cell references from the formula, e.g., [rowId:colField]
		const newDependencies = this.extractReferences(formula);

		// Circular dependency check using DFS path tracking
		if (this.wouldIntroduceCycle(targetKey, newDependencies)) {
			throw new Error(`Circular dependency detected: Applying "${formula}" to cell [${rowId}:${colField}] would create an evaluation loop.`);
		}

		// Clear old dependencies if they exist
		this.unregisterFormulaDependencies(targetKey);

		// Save the formula
		if (!this.formulas.has(targetKey)) {
			this.formulaCountByField.set(colField, (this.formulaCountByField.get(colField) ?? 0) + 1);
		}
		this.formulas.set(targetKey, formula);

		// Register new dependencies
		const depSet = new Set<string>();
		for (const depKey of newDependencies) {
			depSet.add(depKey);
			if (!this.dependents.has(depKey)) {
				this.dependents.set(depKey, new Set());
			}
			this.dependents.get(depKey)!.add(targetKey);
		}
		this.dependencies.set(targetKey, depSet);

		// Mark target and all its dependents as dirty
		const invalidated = new Map<string, FormulaCellCoordinate>();
		this.invalidateCell(rowId, colField, invalidated);
	}

	/** Some cell of the column holds a formula. */
	public hasFormulasInField(colField: string): boolean {
		return this.formulaCountByField.has(colField);
	}

	/**
	 * Remove a formula from a cell.
	 */
	public clearFormula(rowId: string, colField: string): void {
		if (!this.formulaCountByField.has(colField)) return;
		const targetKey = this.getCellKey(rowId, colField);
		if (this.formulas.has(targetKey)) {
			this.formulas.delete(targetKey);
			const remaining = (this.formulaCountByField.get(colField) ?? 1) - 1;
			if (remaining > 0) this.formulaCountByField.set(colField, remaining);
			else this.formulaCountByField.delete(colField);
			this.unregisterFormulaDependencies(targetKey);
			const invalidated = new Map<string, FormulaCellCoordinate>();
			this.invalidateCell(rowId, colField, invalidated);
		}
	}

	/**
	 * Check if a cell has a formula registered.
	 */
	public hasFormula(rowId: string, colField: string): boolean {
		if (!this.formulaCountByField.has(colField)) return false;
		return this.formulas.has(this.getCellKey(rowId, colField));
	}

	/**
	 * Retrieve the registered formula for a cell, if any.
	 */
	public getFormula(rowId: string, colField: string): string | undefined {
		if (!this.formulaCountByField.has(colField)) return undefined;
		return this.formulas.get(this.getCellKey(rowId, colField));
	}

	public getCachedFormulaValue(rowId: string, colField: string): { hasCached: boolean; value: unknown } {
		if (this.cache.size === 0 || !this.formulaCountByField.has(colField)) return NO_CACHED_FORMULA_VALUE;
		const key = this.getCellKey(rowId, colField);
		if (this.cache.has(key) && !this.dirty.has(key)) {
			return { hasCached: true, value: this.cache.get(key) };
		}
		return { hasCached: false, value: undefined };
	}

	public clearAll(): void {
		this.dependents.clear();
		this.dependencies.clear();
		this.cache.clear();
		this.formulas.clear();
		this.formulaCountByField.clear();
		this.dirty.clear();
		this.isEvaluating.clear();
	}

	/**
	 * Resolve and evaluate a cell value. If it's a formula, evaluate it lazily and use cache.
	 * If it is a raw value, return it directly.
	 */
	public getCellValue(rowId: string, colField: string, getRawValue: (rId: string, cField: string) => unknown): unknown {
		if (!this.formulaCountByField.has(colField)) return getRawValue(rowId, colField);
		const key = this.getCellKey(rowId, colField);
		const formula = this.formulas.get(key);

		if (formula === undefined) {
			return getRawValue(rowId, colField);
		}

		// If cached and not dirty, return the cached value
		if (this.cache.has(key) && !this.dirty.has(key)) {
			return this.cache.get(key);
		}

		// Reentrancy protection
		if (this.isEvaluating.has(key)) {
			throw new Error(`Circular reference evaluated at runtime for cell [${rowId}:${colField}].`);
		}

		this.isEvaluating.add(key);
		try {
			const computedVal = this.evaluateFormula(formula, getRawValue);
			this.cache.set(key, computedVal);
			this.dirty.delete(key);
			return computedVal;
		} finally {
			this.isEvaluating.delete(key);
		}
	}

	/**
	 * Explicitly marks a cell as modified (e.g., manual value edit).
	 * Recursively invalidates all dependent cell caches.
	 * Returns the list of cell keys that were invalidated.
	 */
	public invalidateCell(rowId: string, colField: string, invalidated: Map<string, FormulaCellCoordinate> = new Map()): FormulaCellCoordinate[] {
		// A grid without formulas (the common case, and every live-feed write): nothing depends on any
		// cell, so there is nothing to invalidate.
		if (this.formulas.size === 0 && this.dependents.size === 0) return invalidated.size === 0 ? NO_CELLS : Array.from(invalidated.values());
		const key = this.getCellKey(rowId, colField);
		// A plain cell that no formula reads: no cached result, no dependents.
		if (invalidated.size === 0 && !this.formulas.has(key) && !this.dependents.has(key)) return NO_CELLS;
		if (invalidated.has(key)) return [];

		invalidated.set(key, { rowId, colField });
		this.cache.delete(key);
		this.dirty.add(key);

		const dependentsSet = this.dependents.get(key);
		if (dependentsSet) {
			for (const depKey of dependentsSet) {
				const depCoordinate = this.parseInternalCellKey(depKey);
				if (depCoordinate) {
					this.invalidateCell(depCoordinate.rowId, depCoordinate.colField, invalidated);
				}
			}
		}

		return Array.from(invalidated.values());
	}

	private getCellKey(rowId: string, colField: string): string {
		return `${rowId}\u0000${colField}`;
	}

	private parseInternalCellKey(key: string): FormulaCellCoordinate | null {
		const separatorIdx = key.indexOf('\u0000');
		if (separatorIdx === -1) return null;
		return {
			rowId: key.substring(0, separatorIdx),
			colField: key.substring(separatorIdx + 1),
		};
	}

	/**
	 * Scans a formula string to extract all dependent cell coordinates matching `[rowId:colField]`.
	 */
	private extractReferences(formula: string): string[] {
		const regex = /\[(.+?):([^\]:]+)\]/g;
		const references: string[] = [];
		let match;
		while ((match = regex.exec(formula)) !== null) {
			references.push(this.getCellKey(match[1], match[2]));
		}
		return references;
	}

	/**
	 * Check if adding dependencies for targetKey would introduce a cycle.
	 * Traverse downstream dependents of targetKey using DFS. If we reach any of the new dependencies, a cycle is present.
	 */
	private wouldIntroduceCycle(targetKey: string, newDependencies: string[]): boolean {
		const visited = new Set<string>();

		const dfs = (curr: string): boolean => {
			if (newDependencies.includes(curr)) {
				return true;
			}
			if (visited.has(curr)) {
				return false;
			}
			visited.add(curr);

			const deps = this.dependents.get(curr);
			if (deps) {
				for (const dep of deps) {
					if (dfs(dep)) return true;
				}
			}
			return false;
		};

		return dfs(targetKey);
	}

	private unregisterFormulaDependencies(targetKey: string): void {
		const oldDeps = this.dependencies.get(targetKey);
		if (oldDeps) {
			for (const depKey of oldDeps) {
				const dependentsSet = this.dependents.get(depKey);
				if (dependentsSet) {
					dependentsSet.delete(targetKey);
					if (dependentsSet.size === 0) {
						this.dependents.delete(depKey);
					}
				}
			}
			this.dependencies.delete(targetKey);
		}
	}

	/**
	 * Evaluates formula strings by resolving cell references and parsing the expression safely.
	 */
	private evaluateFormula(formula: string, getRawValue: (rId: string, cField: string) => unknown): unknown {
		// Strip leading '=' if present
		let expr = formula.trim();
		if (expr.startsWith('=')) {
			expr = expr.substring(1).trim();
		}

		// 1. Resolve cell references [rowId:colField] to their current values
		const refRegex = /\[(.+?):([^\]:]+)\]/g;
		expr = expr.replace(refRegex, (_, rId, cField) => {
			const resolved = this.getCellValue(rId, cField, getRawValue);
			const num = Number(resolved);
			// Fallback to string or numeric representation
			return !Number.isNaN(num) && resolved !== '' ? String(num) : `"${String(resolved).replace(/"/g, '\\"')}"`;
		});

		// 2. Pre-process known spreadsheet functions (SUM, AVERAGE, MIN, MAX)
		expr = this.evaluateFunctions(expr);

		// 3. Evaluate the remaining pure arithmetic expression safely without eval
		try {
			return this.parseArithmetic(expr);
		} catch (err) {
			return `#VALUE! (${(err as Error).message})`;
		}
	}

	/**
	 * Scans for function calls like SUM(1, 2, 3) and computes them recursively.
	 */
	private evaluateFunctions(expr: string): string {
		const funcs = ['SUM', 'AVERAGE', 'MIN', 'MAX'] as const;
		let updated = expr;

		for (const funcName of funcs) {
			const pattern = new RegExp(`${funcName}\\s*\\(`, 'gi');
			let match;

			// We scan from right-to-left or keep replacing the innermost matches to handle nested calls
			while (true) {
				pattern.lastIndex = 0;
				match = pattern.exec(updated);
				if (!match) break;

				const startIdx = match.index;
				const openParenIdx = startIdx + match[0].length - 1;

				// Find matching closing parenthesis
				let balance = 1;
				let closeParenIdx = -1;
				for (let i = openParenIdx + 1; i < updated.length; i++) {
					if (updated[i] === '(') balance++;
					else if (updated[i] === ')') {
						balance--;
						if (balance === 0) {
							closeParenIdx = i;
							break;
						}
					}
				}

				if (closeParenIdx === -1) {
					// Unbalanced parentheses
					break;
				}

				// Extract args string, split by commas, evaluate each arg
				const argsString = updated.substring(openParenIdx + 1, closeParenIdx);
				const args = argsString.split(',').map((arg) => {
					const evaluatedArg = this.evaluateFunctions(arg.trim());
					return Number(this.parseArithmetic(evaluatedArg)) || 0;
				});

				let result: number = 0;
				if (funcName.toUpperCase() === 'SUM') {
					result = args.reduce((sum, val) => sum + (Number(val) || 0), 0);
				} else if (funcName.toUpperCase() === 'AVERAGE') {
					result = args.length > 0 ? args.reduce((sum, val) => sum + (Number(val) || 0), 0) / args.length : 0;
				} else if (funcName.toUpperCase() === 'MIN') {
					result = args.length > 0 ? Math.min(...args.map((v) => Number(v) || 0)) : 0;
				} else if (funcName.toUpperCase() === 'MAX') {
					result = args.length > 0 ? Math.max(...args.map((v) => Number(v) || 0)) : 0;
				}

				// Replace the function call with its computed result
				updated = updated.substring(0, startIdx) + String(result) + updated.substring(closeParenIdx + 1);
			}
		}

		return updated;
	}

	/**
	 * Safe mathematical expression evaluator that supports +, -, *, /, parenthesis, and numbers.
	 * Utilizes a Shunting-yard tokenizer and evaluation engine.
	 */
	private parseArithmetic(expr: string): string | number {
		const cleanExpr = expr.trim();
		if (cleanExpr === '') return 0;

		// If it's a simple quoted string, return the inner content
		if (cleanExpr.startsWith('"') && cleanExpr.endsWith('"')) {
			return cleanExpr.substring(1, cleanExpr.length - 1);
		}

		// Tokenize
		const tokens: string[] = [];
		let i = 0;
		while (i < cleanExpr.length) {
			const char = cleanExpr[i];

			if (/\s/.test(char)) {
				i++;
				continue;
			}

			// Numbers (including decimals)
			if (/[0-9.]/.test(char)) {
				let numStr = '';
				while (i < cleanExpr.length && /[0-9.]/.test(cleanExpr[i])) {
					numStr += cleanExpr[i];
					i++;
				}
				tokens.push(numStr);
				continue;
			}

			// Basic Operators & Parentheses
			if (char === '+' || char === '-' || char === '*' || char === '/' || char === '(' || char === ')') {
				// Handle unary minus / positive numbers at the start or after another operator
				if (
					char === '-' &&
					(tokens.length === 0 || tokens[tokens.length - 1] === '(' || ['+', '-', '*', '/'].includes(tokens[tokens.length - 1]))
				) {
					let numStr = '-';
					i++;
					while (i < cleanExpr.length && /[0-9.]/.test(cleanExpr[i])) {
						numStr += cleanExpr[i];
						i++;
					}
					tokens.push(numStr);
					continue;
				}

				tokens.push(char);
				i++;
				continue;
			}

			// Strings in quotes or general identifiers
			if (char === '"') {
				let strVal = '';
				i++; // Skip leading quote
				while (i < cleanExpr.length && cleanExpr[i] !== '"') {
					strVal += cleanExpr[i];
					i++;
				}
				i++; // Skip trailing quote
				tokens.push(`"${strVal}"`);
				continue;
			}

			// Unknown characters (let's push them as single characters)
			tokens.push(char);
			i++;
		}

		if (tokens.length === 0) return 0;
		if (tokens.length === 1) {
			const single = tokens[0];
			if (single.startsWith('"') && single.endsWith('"')) {
				return single.substring(1, single.length - 1);
			}
			const num = Number(single);
			return Number.isNaN(num) ? single : num;
		}

		// Shunting-yard algorithm
		const values: number[] = [];
		const ops: string[] = [];

		const applyOp = () => {
			const op = ops.pop();
			const b = values.pop();
			const a = values.pop();
			if (op === undefined || a === undefined || b === undefined) {
				throw new Error('Malformed arithmetic expression');
			}
			switch (op) {
				case '+':
					values.push(a + b);
					break;
				case '-':
					values.push(a - b);
					break;
				case '*':
					values.push(a * b);
					break;
				case '/':
					if (b === 0) throw new Error('Division by zero');
					values.push(a / b);
					break;
			}
		};

		const precedence = (op: string): number => {
			if (op === '+' || op === '-') return 1;
			if (op === '*' || op === '/') return 2;
			return 0;
		};

		for (let j = 0; j < tokens.length; j++) {
			const t = tokens[j];

			if (t === '(') {
				ops.push(t);
			} else if (t === ')') {
				while (ops.length > 0 && ops[ops.length - 1] !== '(') {
					applyOp();
				}
				ops.pop(); // Pop '('
			} else if (['+', '-', '*', '/'].includes(t)) {
				while (ops.length > 0 && precedence(ops[ops.length - 1]) >= precedence(t)) {
					applyOp();
				}
				ops.push(t);
			} else {
				// Parse number or resolve string
				let val = 0;
				if (t.startsWith('"') && t.endsWith('"')) {
					// Strings evaluate to 0 in numeric arithmetic context or fall back
					val = 0;
				} else {
					val = Number(t);
					if (Number.isNaN(val)) {
						val = 0;
					}
				}
				values.push(val);
			}
		}

		while (ops.length > 0) {
			applyOp();
		}

		return values.length === 1 ? values[0] : 0;
	}
}
