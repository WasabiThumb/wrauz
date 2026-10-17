import { createContext } from "svelte";
import type {ZipFile, ZipEntry} from "wrauz";

//

export interface DemoContext {
    path: string;
    file: ZipFile | null;
    selection: ZipEntry | null;
    loading: boolean;
}

const [ get, set ] = createContext<DemoContext>();

//

export const getDemoContext = get;

export function initDemoContext(): DemoContext {
    const ret: DemoContext = $state({
        path: "",
        file: null,
        selection: null,
        loading: false,
    });
    set(ret);
    return ret;
}
