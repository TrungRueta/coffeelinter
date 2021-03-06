'use strict';

import * as coffeeLint from 'coffeelint';
import * as fs from 'fs';
import * as path from 'path';
import { URL } from 'url';

import {
	CompletionItem, CompletionItemKind,
	createConnection, Diagnostic, DiagnosticSeverity,
	IConnection, InitializeParams, InitializeResult, IPCMessageReader,
	IPCMessageWriter, TextDocument, TextDocumentIdentifier,
	TextDocuments, TextDocumentSyncKind
} from 'vscode-languageserver';

let connection: IConnection = createConnection(new IPCMessageReader(process), new IPCMessageWriter(process));

let documents: TextDocuments = new TextDocuments();
documents.listen(connection);

let enabled = true;
let lintConfig = {};
let settingConfig = {};
let workspaceConfig = {};

interface ISettings {
	coffeelinter: ICoffeeLintSettings;
}

interface ICoffeeLintSettings {
	enable: boolean;
	defaultRules: object;
}

function mergeConfig(paramSettingConfig, paramWorkspaceConfig) {
	settingConfig = paramSettingConfig;
	workspaceConfig = paramWorkspaceConfig;

	lintConfig = Object.assign({}, settingConfig);
	Object.assign(lintConfig, workspaceConfig);
}

connection.onDidChangeConfiguration((change) => {
	let settings = change.settings as ISettings;
	enabled = settings.coffeelinter.enable;

	mergeConfig(settings.coffeelinter.defaultRules, workspaceConfig);

	documents.all().forEach(validateTextDocument);
});

function loadWorkspaceConfig(coffeeLintConfigURI) {
	try {
		// console.log(coffeeLintConfigURI);

		let content = fs.readFileSync(coffeeLintConfigURI, 'utf-8').replace(new RegExp("//.*", "gi"), "");
		workspaceConfig = JSON.parse(content);
	}
	catch (error) {
		// workspaceConfig = {};
		console.log("No valide locale lint config");
	}

	mergeConfig(settingConfig, workspaceConfig);
}

connection.onDidChangeWatchedFiles((change) => {
	loadWorkspaceConfig(new URL(change.changes[0].uri));
	documents.all().forEach(validateTextDocument);
});

connection.onInitialize((params): InitializeResult => {
	let sourcePath = params.rootPath || "";
	let coffeeLintConfigFile = path.join(sourcePath, 'coffeelint.json');

	loadWorkspaceConfig(coffeeLintConfigFile);

	return {
		capabilities: {
			textDocumentSync: documents.syncKind
		}
	};
});

documents.onDidChangeContent((change) => {
	validateTextDocument(change.document);
});

function validateTextDocument(textDocument: TextDocument): void {
	let diagnostics: Diagnostic[] = [];

	if (!enabled) {
		return connection.sendDiagnostics({ uri: textDocument.uri, diagnostics });
	}

	let text = textDocument.getText();
	let issues = coffeeLint.lint(text, lintConfig);

	for (let issue of issues) {
		let severity;

		if (issue.level === "warning" || issue.level === "warn") {
			severity = DiagnosticSeverity.Warning;
		}
		else if (issue.level === "error") {
			severity = DiagnosticSeverity.Error;
		}
		else if (issue.level === "hint") {
			severity = DiagnosticSeverity.Hint;
		}
		else {
			severity = DiagnosticSeverity.Information;
		}

		diagnostics.push({
			severity: severity,
			range: {
				start: { line: issue.lineNumber - 1, character: 0 },
				end: { line: issue.lineNumber - 1, character: Number.MAX_VALUE } // end of line
			},
			source: "CoffeeLint",
			message: issue.message
		});
	}

	connection.sendDiagnostics({ uri: textDocument.uri, diagnostics });
}

connection.listen();
