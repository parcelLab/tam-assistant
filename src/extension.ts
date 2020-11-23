// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import { stat } from 'fs';
import * as vscode from 'vscode';
import {
    workspace, ExtensionContext, TextDocument, languages, Uri,
    Diagnostic, DiagnosticCollection, TextDocumentContentChangeEvent
} from 'vscode';
var accepts = require('mongodb-language-model').accepts
import { EJSON } from "bson";
import * as cp from 'child_process';

let diagnosticCollection: vscode.DiagnosticCollection;

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

    diagnosticCollection = vscode.languages.createDiagnosticCollection('tam-assistant');
    context.subscriptions.push(diagnosticCollection);

    let disposable = vscode.commands.registerCommand('tam-assistant.checkFile', async () => {
        diagnosticCollection.clear();
        vscode.Range
        // The code you place here will be executed every time your command is executed
        console.log("checking file")
        let editor: vscode.TextEditor | undefined = vscode.window.activeTextEditor
        if (!editor) return
        if (editor.document.languageId !== 'javascript') {
            vscode.window.showInformationMessage('Not a javascript file')
            return
        }
        if (!/conf\/user\/trigger/.test(editor.document.fileName)) {
            vscode.window.showInformationMessage('Not a trigger file')
            return
        }
        let triggerFile = await import(editor.document.fileName)
        let wrongFilters = checkTriggerFile(triggerFile)

        // modules can only be imported once, that's why we need to delete it straight away
        delete require.cache[require.resolve(editor.document.fileName)]

        if (wrongFilters.length === 0) {
            vscode.window.showInformationMessage('All good!')
            return
        }
        let diagnosticMap: Map<string, vscode.Diagnostic[]> = new Map();
        let diagnostics = diagnosticMap.get(editor.document.fileName);
        for (const elem of wrongFilters) {
            vscode.window.showWarningMessage(`${elem.error} at ${elem.Message}`)
            let rangeArr = getPositionOf(editor.document.getText(), `Message: '${elem.Message}'`, true)
            if (!diagnostics) { diagnostics = []; }
            for (const range of rangeArr) {
                var diagnostic = new vscode.Diagnostic(range, elem.error, 1)
                diagnostic.source = 'tam-assistant'
                diagnostics.push(diagnostic);
            }
        }
        diagnosticCollection.set(editor.document.uri, diagnostics)

    });

    context.subscriptions.push(disposable);

    disposable = vscode.commands.registerCommand('tam-assistant.setUpEnv', async () => {
        vscode.window.showInformationMessage('Attempting to setUpEnv!')
        var extensionList = await execShell('code --list-extensions')
        if (!extensionList.includes('chenxsan.vscode-standardjs')) {
            console.log(await execShell('code --install-extension chenxsan.vscode-standardjs'))
            // enable autoFixOnSave
            vscode.workspace.getConfiguration().update('standard.autoFixOnSave', true, true)
            vscode.window.showInformationMessage('Successfully installed standardjs!')
        }
        if (!extensionList.includes('dbaeumer.vscode-eslint')) {
            console.log(await execShell('code --install-extension dbaeumer.vscode-eslint'))
            // set correct workspace config
            vscode.workspace.getConfiguration().update('eslint.workingDirectories', ["./", "./conf/user/trigger"], true)
            vscode.window.showInformationMessage('Successfully installed esLint!')
        }

    })

    context.subscriptions.push(disposable);

    vscode.commands.executeCommand('tam-assistant.setUpEnv')

    context.subscriptions.push(workspace.onDidSaveTextDocument(async (document) => {
        if (vscode.workspace.getConfiguration().get('tamAssistant.checkOnSave')) {
            vscode.commands.executeCommand('tam-assistant.checkFile')
        }
    }));

    let registerInsertCommand = (functionName: string, functionCall: string) => {
        disposable = vscode.commands.registerCommand(`tam-assistant.${functionName}`, () => {
            let editor: vscode.TextEditor = vscode.window.activeTextEditor!
            editor.edit((selectedText) => {
                selectedText.replace(editor.selection, functionCall);
            })
        })
        context.subscriptions.push(disposable);
    }

    registerInsertCommand('isInList', 'isInList(field, list)')
    registerInsertCommand('startsWith', 'startsWith(field, string)')
    registerInsertCommand('endsWith', 'endsWith(field, string)')
    registerInsertCommand('contains', 'contains(field, string options)')
    registerInsertCommand('contactedWithMessage', 'contactedWithMessage(messageType)')
    registerInsertCommand('contactedWithOneOfMessages', 'contactedWithOneOfMessages(messageTypeList)')
    registerInsertCommand('contactedWithAllOfMessages', 'contactedWithAllOfMessages(messageTypeList)')


}

// this method is called when your extension is deactivated
export function deactivate() { }

function checkTriggerFile(requiredFile: object) {
    console.log(requiredFile)

    let wrongFilters = []
    for (const trigger in requiredFile) {
        // @ts-ignore :)
        for (const status of requiredFile[trigger]) {

            // Filter not available, skip or throw error?
            if (!status.Filter) continue

            // empty filters are fine
            if ((Object.keys(status.Filter).length === 0)) continue

            // check if top elem is $and
            if ((Object.keys(status.Filter).length > 1) || (!status.Filter['$and'])) {
                status.error = 'Filter not wrapped in $and'
                wrongFilters.push(status)
                continue
            }

            //check for valid mongo query syntax
            // try {
            //     accepts(EJSON.stringify(status.Filter, { legacy: true }))
            // } catch (error) {
            //     console.log(EJSON.stringify(status.Filter, { legacy: true }))
            //     status.error = error.message
            //     wrongFilters.push(status)
            //     continue
            // }
            if (!accepts(EJSON.stringify(status.Filter, { legacy: true }))) {
                status.error = `Invalid mongo query syntax: ${EJSON.stringify(status.Filter, { legacy: true })}`
                wrongFilters.push(status)
                continue
            }

        }
    }
    return wrongFilters
}

// performance was never an option
function getPositionOf(str: string, searchStr: string, caseSensitive: boolean) {
    var searchStrLen = searchStr.length;
    if (searchStrLen == 0) {
        return [];
    }
    var startIndex = 0, index, indices = [];
    if (!caseSensitive) {
        str = str.toLowerCase();
        searchStr = searchStr.toLowerCase();
    }
    while ((index = str.indexOf(searchStr, startIndex)) > -1) {
        var tempString = str.substring(0, index);
        var lineNumber = tempString.split('\n').length - 1;
        var line = str.split('\n')[lineNumber]
        var startOfLine = line.indexOf(searchStr)
        var endOfLine = line.length
        var range = new vscode.Range(lineNumber, startOfLine, lineNumber, endOfLine)
        indices.push(range);
        startIndex = index + searchStrLen;
    }
    return indices;
}

async function execShell(cmd: string) {
    return new Promise<string>((resolve, reject) => {
        cp.exec(cmd, (err, out) => {
            if (err) {
                return reject(err);
            }
            return resolve(out);
        });
    });
}
