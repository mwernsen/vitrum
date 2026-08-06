import '@vitrum/ui/design/styles.css'
import './site.css'
import { mount } from 'svelte'
import App from './App.svelte'

const target = document.getElementById('app')
if (!target) throw new Error('missing #app mount point')

mount(App, { target })
