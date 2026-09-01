import { createApp } from 'vue';
import App from './App.vue';
const app = createApp(App);

import axios from 'axios';
import VueAxios from 'vue-axios';
app.use(VueAxios, axios);

// Attaches the stored admin password to every request and re-prompts once on a 401, for crashes
// and reports alike. Installed on the axios instance BEFORE the app mounts, so the first request
// a component makes on mount already carries the header.
import { installAuth } from './auth';
installAuth(axios);

import 'bootstrap/dist/css/bootstrap.min.css'
//import 'bootstrap/dist/js/bootstrap.min.js'

app.mount('#app');
