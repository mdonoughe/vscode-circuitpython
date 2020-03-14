import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as axios from 'axios';
import * as unzip from 'unzipper';
import { String } from 'typescript-string-operations';
import * as _ from 'lodash';
import { Library } from './library';
import * as globby from 'globby';
import * as fs_extra from 'fs-extra';
import { Context } from '../context';

class LibraryQP implements vscode.QuickPickItem {
  public label: string = null;
  public description: string = null;

  public bundleLib: Library = null;
  public projectLib: Library = null;

  private op: string = null;
  public constructor(b: Library, p: Library) {
    this.bundleLib = b;
    this.projectLib = p;
    this.label = b.name;

    if(p === null) {
      this.op = "install";
      this.description = `Install version ${b.version}`;
    } else if(b.version !== p.version) {
      this.op = "update";
      this.description = `Update from v${p.version} to v${b.version}`;
    } else {
      this.op = null;
      this.description = `v${p.version} is installed and up to date.`;
    }
  }

  public onClick() {
    switch (this.op) {
      case "install":
        this.install();
        break;
      case "update":
        this.update();
        break;
      
      default:
        //vscode.window.showInformationMessage(this.label);
        break;
    }
    LibraryManager.getInstance().reloadProjectLibraries();
  }
  private install() {
    let src: string = LibraryManager.getMpy(path.basename(this.bundleLib.path));
    if(this.bundleLib.directory) {
      fs_extra.copySync(
        src,
        path.join(LibraryManager.getInstance().projectLibDir, path.basename(this.bundleLib.path)),
        { overwrite: true }
      );
    } else {
      fs.copyFileSync(
        src,
        path.join(LibraryManager.getInstance().projectLibDir, path.basename(this.bundleLib.path, ".py") + ".mpy"),
      );
    }
  }

  private update() {
    this.install();
  }
}
export class LibraryManager implements vscode.Disposable {
  public static BUNDLE_URL: string = "https://github.com/adafruit/Adafruit_CircuitPython_Bundle";
  public static BUNDLE_SUFFIXES: string[] = [
    'py', '4.x-mpy', '5.x-mpy'
  ];
  public static BUNDLE_VERSION_REGEX: RegExp = /\d\d\d\d\d\d\d\d/; //new RegExp('[\\d', 'i')
  public static DUNDER_ASSIGN_RE: RegExp = /^__\w+__\s*=\s*['"].+['"]$/;
  private storageRoot: string = null;
  private bundleDir: string = null;
  private localBundleDir: string = null;
  public tag: string = null;
  public cpVersion = null;
  public mpySuffix: string = "py";
  public projectLibDir: string = null;
  private libraries: Map<string, Library> = new Map<string, Library>();
  private workspaceLibraries: Map<string, Library> = new Map<string, Library>();
  
  public static getInstance(): LibraryManager {
    return LibraryManager._libraryManager;
  }
  public static async newInstance(storagePath: string) {
    let l: LibraryManager = new LibraryManager();
    l.setStorageRoot(storagePath);

    LibraryManager._libraryManager = l;
    LibraryManager._libraryManager.initialize();
  }
  private static _libraryManager: LibraryManager = null;

  private async initialize() {
    // Get the latest Adafruit_CircuitPython_Bundle
    await this.updateBundle();
    // Store the library metadata in memory
    this.libraries = await this.loadBundleMetadata();

    // Figure out where the project is keeping libraries.
    this.projectLibDir = this.getProjectLibDir();

    // Get their metadata
    this.workspaceLibraries = await this.loadLibraryMetadata(this.projectLibDir);

    this.cpVersion = this.getProjectCPVer();
    let v: string[] = this.cpVersion.split(".");
    if(LibraryManager.BUNDLE_SUFFIXES.includes(`${v[0]}.x-mpy`)) {
      this.mpySuffix = `${v[0]}.x-mpy`;
    }
    console.log("It's loaded!");
  }

  public completionPath(): string {
    if(this.localBundleDir === null) {
      // In case nothing exists yet.
      return null;
    }
    return path.join(
      this.localBundleDir,
      "lib"
    );
  }

  public async reloadProjectLibraries() {
    this.workspaceLibraries = await this.loadLibraryMetadata(this.projectLibDir);
  }

  public async show() {
    let choices: LibraryQP[] = this.getAllChoices();
    const chosen = await vscode.window.showQuickPick(choices);
    if (chosen) {
      chosen.onClick();
    }
  }

  public async list() {
    let choices: LibraryQP[] = this.getInstalledChoices();
    const chosen = await vscode.window.showQuickPick(choices);
    if (chosen) {
      chosen.onClick();
    }
  }

  public async update() {
    let choices: LibraryQP[] = this.getInstalledChoices();
    choices.forEach((c: LibraryQP) => {
      c.onClick();
    });
  }

  private getAllChoices(): LibraryQP[] {
    let installedChoices: LibraryQP[] = this.getInstalledChoices();
    let uninstalledChoices: LibraryQP[] = this.getUninstalledChoices();
    return installedChoices.concat(uninstalledChoices);
  }

  private getInstalledChoices(): LibraryQP[] {
    let choices: LibraryQP[] = new Array<LibraryQP>();
    Array.from(this.workspaceLibraries.keys()).sort().forEach((v,i,a) => {
      let b: Library = this.libraries.get(v);
      let p: Library = this.workspaceLibraries.get(v);
      choices.push(new LibraryQP(b, p));
    });
    return choices;
  }

  private getUninstalledChoices(): LibraryQP[] {
    let choices: LibraryQP[] = new Array<LibraryQP>();
    Array.from(this.libraries.keys()).sort().forEach((v,i,a) => {
      let b: Library = this.libraries.get(v);
      if (!this.workspaceLibraries.has(v)) {
        choices.push(new LibraryQP(b, null));
      }
    });
    return choices;
  }

  private getProjectCPVer(): string {
    let bootOut: string = null;
    let ver: string = "unknown";
    vscode.workspace.workspaceFolders.forEach((f) => {
      let b: string = path.join(
        f.uri.path,
        "boot_out.txt"
      );
      console.log(b);
      if (bootOut === null && fs.existsSync(b)) {
        bootOut = b;
        ver = fs.readFileSync(bootOut).toString().split(";")[0].split(" ")[2];
      }
    });
    return ver;
  }
  private getProjectLibDir(): string {
    let libDir: string = null;

    vscode.workspace.workspaceFolders.forEach((f) => {
      let l: string = path.join(
        f.uri.path,
        "lib"
      );
      console.log(l);
      if (libDir === null && fs.existsSync(l)) {
        libDir = l;
      }
    });
    return libDir;
  }

  private setStorageRoot(root: string) {
    this.storageRoot = root;
    this.bundleDir = path.join(this.storageRoot, "bundle");
    fs.mkdirSync(this.bundleDir, {recursive: true});
    let tag: string = this.getMostRecentBundleOnDisk();
    if(tag !== undefined && this.verifyBundle(tag)) {
      this.tag = tag;
      this.localBundleDir = path.join(this.bundleDir, tag);
    }
  }

  // TODO: updateBundle doesn't remove older bundles
  private async updateBundle() {
    let tag: string = await this.getLatestBundleTag();
    if (tag === this.tag) {
      vscode.window.showInformationMessage(`Bundle already at latest version: ${tag}`);
    } else {
      vscode.window.showInformationMessage(`Downloading new bundle: ${tag}`);
      await this.getBundle(tag);
      this.tag = tag;
      vscode.window.showInformationMessage(`Bundle updated to ${tag}`);
    }
    this.verifyBundle(tag);
    Context.resetCompletionPath();
  }

  private verifyBundle(tag: string): boolean {
    let localBundleDir: string = path.join(this.bundleDir, tag);
    if(!fs.existsSync(localBundleDir)) {
      return false;
    }
    let bundles: string[] = fs.readdirSync(localBundleDir).sort();
    if(!(bundles.length === 3)) {
      return false;
    }
    bundles.forEach(b => {
      let p: string = path.join(localBundleDir, b);
      let lib: string[] = fs.readdirSync(p).filter((v,i,a) => v === "lib");
      if(lib.length !== 1) {
        return false;
      }
    });
    this.localBundleDir = localBundleDir;
    return true;
  }

  private getMostRecentBundleOnDisk(): string {
    if(!fs.existsSync(this.bundleDir)) {
      return null;
    }
    let tag: string = 
      fs.readdirSync(this.bundleDir)
      .filter((dir: string, i: number, a: string[]) => LibraryManager.BUNDLE_VERSION_REGEX.test(dir))
      .sort()
      .reverse()
      .shift();
    console.log(tag);
    return(tag);
  }
  /*
  Gets latest tag
  */
  private async getLatestBundleTag(): Promise<string> {
    let r: axios.AxiosResponse = 
      await axios.default.get(
        'https://github.com/adafruit/Adafruit_CircuitPython_Bundle/releases/latest', 
        { headers : { 'Accept': 'application/json'}}
      );
    return await r.data.tag_name;
  }

  /*
  Downloads 4.x, 5.x and source bundles. Source are crucial for autocomplete
  */
  private async getBundle(tag: string) {
    let urlRoot: string = LibraryManager.BUNDLE_URL + '/releases/download/{0}/adafruit-circuitpython-bundle-{1}-{0}.zip';

    LibraryManager.BUNDLE_SUFFIXES.forEach(async s => {
      let url: string = String.Format(urlRoot, tag, s);
      let r: axios.AxiosResponse = await axios.default.get(url, {responseType: 'stream'});
      await r.data.pipe(unzip.Extract({ path: path.join(this.storageRoot, "bundle", this.tag) }));
    });
  }

  public static getMpy(name: string): string {
    if(path.extname(name) === ".py") {
      name = path.basename(name, ".py") + ".mpy";
    }
    return path.join(
      LibraryManager._libraryManager.bundlePath(LibraryManager._libraryManager.mpySuffix), 
      name
    );
  }

  private bundlePath(suffix: string): string {
    return path.join(
      this.localBundleDir,
      `adafruit-circuitpython-bundle-${suffix}-${this.tag}`,
      `lib`
    );
  }

  private async loadBundleMetadata(): Promise<Map<string, Library>> {
    return this.loadLibraryMetadata(this.bundlePath("py"));
  }

  private async loadLibraryMetadata(rootDir: string): Promise<Map<string, Library>> {
    let paths: string[] = 
      await globby( '*',
                    {absolute: true, cwd: rootDir, deep: 1, onlyFiles: false}
      );
    
    let libraries: Array<Promise<Library>> =
      paths.map((p, i, a) => Library.from(p));

    return new Promise<Map<string, Library>>(async (resolve, reject) => {
      let libs: Array<Library> = await Promise.all(libraries).catch((error) => {
        console.log(error);
        return new Array<Library>();
      });

      let libraryMetadata: Map<string, Library> = new Map<string, Library>();
      libs.forEach((l: Library) => {
        libraryMetadata.set(l.name, l);
      });
      return resolve(libraryMetadata);
    });
  }

  public dispose() {}

  private constructor() {
  }
}