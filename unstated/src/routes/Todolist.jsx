import React, {Component} from 'react';
import Todolist from '../features/Todolist';

export default class TodolistPage extends Component {
    render() {
        return <div className="main">
            <Todolist />
        </div>;
    }
}