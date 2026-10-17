import "./main.css";
import { mount } from "svelte";
import Demo from "./components/Demo.svelte";

//

const app = document.querySelector(`#app`)!;

mount(Demo, {
    target: app
});
