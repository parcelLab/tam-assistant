// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import { stat } from 'fs';
import * as vscode from 'vscode';
import {
    workspace, ExtensionContext, TextDocument, languages, Uri,
    Diagnostic, DiagnosticCollection, TextDocumentContentChangeEvent
} from 'vscode';
const accepts = require('mongodb-language-model').accepts
import { EJSON } from "bson";
import * as cp from 'child_process';
const got = require('got');
const download = require('download');

let diagnosticCollection: vscode.DiagnosticCollection;

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

    diagnosticCollection = vscode.languages.createDiagnosticCollection('tam-assistant');
    context.subscriptions.push(diagnosticCollection);

    let disposable = vscode.commands.registerCommand('tam-assistant.checkFile', async () => {
        diagnosticCollection.clear();
        vscode.Range
        let editor: vscode.TextEditor | undefined = vscode.window.activeTextEditor
        if (!editor) return
        if (editor.document.languageId !== 'javascript') {
            return
        }
        if (!/conf\/user\/trigger/.test(editor.document.fileName)) {
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
                const diagnostic = new vscode.Diagnostic(range, elem.error, 1)
                diagnostic.source = 'tam-assistant'
                diagnostics.push(diagnostic);
            }
        }
        diagnosticCollection.set(editor.document.uri, diagnostics)

    });

    context.subscriptions.push(disposable);

    disposable = vscode.commands.registerCommand('tam-assistant.setUpEnv', async () => {
        const extensionList = await execShell('code --list-extensions')
        if (!extensionList.includes('chenxsan.vscode-standardjs')) {
            await execShell('code --install-extension chenxsan.vscode-standardjs')
            // enable autoFixOnSave
            vscode.workspace.getConfiguration().update('standard.autoFixOnSave', true, true)
            vscode.window.showInformationMessage('Successfully installed standardjs!')
        }
        if (!extensionList.includes('dbaeumer.vscode-eslint')) {
            await execShell('code --install-extension dbaeumer.vscode-eslint')
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


    disposable = vscode.commands.registerCommand('tam-assistant.updateAssistant', async () => {
        const download_url = JSON.parse((await got('https://api.github.com/repos/parcelLab/tam-assistant/releases/latest')).body).assets[0].browser_download_url

        const fileNameTMP = download_url.split("/")
        const fileName = fileNameTMP[fileNameTMP.length - 1]

        const fileVersion = fileName.split('.vsix')[0].split('tam-assistant-')[1]
        const installedVersions = await execShell('code --list-extensions --show-versions')
        if (!installedVersions.includes(`tam-assistant@${fileVersion}`)) {
            await download(download_url, 'tmp')
            await execShell(`code --install-extension /tmp/${fileName}`)
            vscode.window.showInformationMessage('Successfully updated the assistant, enjoy your fresh features! 🔥')
        }
    })

    context.subscriptions.push(disposable);

    vscode.commands.executeCommand('tam-assistant.updateAssistant')

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
    const searchStrLen = searchStr.length;
    if (searchStrLen == 0) {
        return [];
    }
    let startIndex = 0, index, indices = [];
    if (!caseSensitive) {
        str = str.toLowerCase();
        searchStr = searchStr.toLowerCase();
    }
    while ((index = str.indexOf(searchStr, startIndex)) > -1) {
        const tempString = str.substring(0, index);
        const lineNumber = tempString.split('\n').length - 1;
        const line = str.split('\n')[lineNumber]
        const startOfLine = line.indexOf(searchStr)
        const endOfLine = line.length
        const range = new vscode.Range(lineNumber, startOfLine, lineNumber, endOfLine)
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
