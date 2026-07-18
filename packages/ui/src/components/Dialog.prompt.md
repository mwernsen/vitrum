Centered modal with 40% ink scrim; pass Buttons via `footer`.

```jsx
<Dialog open={o} title="Delete panel?" onClose={close} footer={<><Button variant="secondary" onClick={close}>Cancel</Button><Button onClick={del}>Delete</Button></>}>This can't be undone.</Dialog>
```
