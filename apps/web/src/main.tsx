import {render} from 'preact';
import {App} from './app/App.js';
import './styles/tokens.css';
import './styles/app.css';

const root = document.getElementById('app');
if (!root) {
  throw new Error('#app element not found');
}
render(<App />, root);
